from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "run_live_cms_e2e.py"
spec = importlib.util.spec_from_file_location("run_live_cms_e2e", SCRIPT)
assert spec and spec.loader
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


def _snap(**overrides: Any) -> dict[str, Any]:
    snap: dict[str, Any] = {
        "revision": ["0004"],
        "ids": {table: [] for table in harness.TABLES},
        "auth_users": ["owner"],
        "storage_objects": [],
        "site_settings": {"id": "s1", "store_name": "Tủ Hòa Bình Nhâm", "logo_url": None, "updated_at": "t0"},
    }
    snap["ids"]["contact_clicks"] = ["c1", "c2"]
    snap.update(overrides)
    return snap


def test_identical_snapshot_has_no_problems() -> None:
    assert harness.diff_baseline(_snap(), _snap()) == []


def test_canonical_store_name_change_is_allowed() -> None:
    after = _snap(site_settings={"id": "s1", "store_name": "Tủ Nhựa Bình Nhâm", "logo_url": None, "updated_at": "t1"})
    assert harness.diff_baseline(_snap(), after) == []


def test_leftovers_and_lost_rows_are_reported() -> None:
    after = _snap(auth_users=["owner", "synthetic"], storage_objects=["banners/x.png"])
    after["ids"] = {**after["ids"], "contact_clicks": ["c1"], "products": ["p-leftover"]}
    after["site_settings"] = {**after["site_settings"], "logo_url": "https://x"}
    problems = " ".join(harness.diff_baseline(_snap(), after))
    for expected in ("contact_clicks", "products", "auth.users", "storage.objects", "site_settings.logo_url"):
        assert expected in problems


def test_frontend_origins_merge_preserves_backend_and_adds_harness_ports() -> None:
    merged = json.loads(
        harness._merge_frontend_origins(
            '["http://localhost:3000", "https://admin.example.test"]', 3200
        )
    )

    assert merged == [
        "http://localhost:3000",
        "https://admin.example.test",
        "http://localhost:3200",
        "http://127.0.0.1:3200",
    ]


def test_frontend_origins_merge_deduplicates_harness_origin() -> None:
    merged = json.loads(
        harness._merge_frontend_origins(
            "http://localhost:3000,http://localhost:3200", 3200
        )
    )

    assert merged.count("http://localhost:3200") == 1
    assert "http://127.0.0.1:3200" in merged


def _settings_snapshot() -> dict[str, Any]:
    settings: dict[str, Any] = {field: None for field in harness.SETTINGS_FIELDS}
    settings.update(
        {
            "id": "00000000-0000-0000-0000-000000000001",
            "store_name": "permanent",
            "updated_at": "t0",
            "contact_tracking_enabled": "False",
        }
    )
    return settings


def test_settings_restore_is_noop_when_fields_match() -> None:
    connection = MagicMock()
    current = {
        **{field: None for field in harness.SETTINGS_FIELDS},
        "contact_tracking_enabled": False,
    }
    connection.execute.return_value.mappings.return_value.first.return_value = current

    changed = harness._restore_settings_if_changed(connection, _settings_snapshot())

    assert changed == []
    assert connection.execute.call_count == 1


def test_settings_restore_updates_only_changed_field() -> None:
    connection = MagicMock()
    current = {
        **{field: None for field in harness.SETTINGS_FIELDS},
        "logo_url": "old",
        "contact_tracking_enabled": False,
    }
    connection.execute.return_value.mappings.return_value.first.return_value = current
    baseline = _settings_snapshot()
    baseline["logo_url"] = "new"

    changed = harness._restore_settings_if_changed(connection, baseline)

    assert changed == ["logo_url"]
    update_params = connection.execute.call_args_list[1].args[1]
    assert update_params == {"logo_url": "new", "id": baseline["id"]}


class _FakeResult:
    def __init__(self, current_settings: dict[str, Any]) -> None:
        self.current_settings = current_settings

    def all(self) -> list[Any]:
        return []

    def mappings(self) -> _FakeResult:
        return self

    def first(self) -> dict[str, Any]:
        return self.current_settings


class _FakeConnection:
    def __init__(self, current_settings: dict[str, Any]) -> None:
        self.current_settings = current_settings
        self.statements: list[str] = []

    def execute(self, statement: Any, params: Any = None) -> _FakeResult:
        self.statements.append(str(statement))
        return _FakeResult(self.current_settings)


@pytest.fixture
def cleanup_fixture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Any, ...]:
    baseline = _snap(site_settings=_settings_snapshot())
    baseline["banners"] = []
    current = {
        **{field: None for field in harness.SETTINGS_FIELDS},
        "contact_tracking_enabled": False,
    }
    connection = _FakeConnection(current)
    transaction = MagicMock()
    transaction.__enter__.return_value = connection
    engine = MagicMock()
    engine.begin.return_value = transaction
    service = MagicMock()
    manifest = harness.Manifest(tmp_path / "run" / "manifest.jsonl")
    monkeypatch.setattr(harness, "_ids", lambda *args, **kwargs: [])
    return engine, service, baseline, manifest, connection


def test_cleanup_is_idempotent_with_no_run_rows(cleanup_fixture: tuple[Any, ...]) -> None:
    engine, service, baseline, manifest, connection = cleanup_fixture

    for _ in range(2):
        harness.cleanup(
            engine,
            service,
            baseline,
            manifest,
            None,
            [],
            "__e2e_gc-test_",
            "e2e-gc-test-",
        )

    mutations = [
        sql for sql in connection.statements if sql.lstrip().lower().startswith(("update", "delete"))
    ]
    assert mutations == []


def test_timeout_kills_disposable_child_tree(tmp_path: Path) -> None:
    marker = tmp_path / "orphan-marker.txt"
    child_code = (
        "import pathlib,time; time.sleep(2); "
        f"pathlib.Path({str(marker)!r}).write_text('orphan', encoding='utf-8')"
    )
    parent_code = (
        "import subprocess,sys,time; "
        f"subprocess.Popen([sys.executable, '-c', {child_code!r}]); time.sleep(30)"
    )

    with pytest.raises(harness.PhaseTimeout):
        harness._run_logged(
            "timeout_test",
            [sys.executable, "-c", parent_code],
            cwd=tmp_path,
            env=dict(os.environ),
            log_path=tmp_path / "timeout.log",
            timeout_seconds=1,
        )
    time.sleep(2.5)

    assert not marker.exists()


def test_interrupt_kills_child_tree(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    process = MagicMock(spec=subprocess.Popen)
    process.wait.side_effect = KeyboardInterrupt
    stopped: list[Any] = []
    monkeypatch.setattr(harness.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(harness, "_stop_tree", stopped.append)

    with pytest.raises(KeyboardInterrupt):
        harness._run_logged(
            "interrupt_test",
            [sys.executable, "-c", "pass"],
            cwd=tmp_path,
            env=dict(os.environ),
            log_path=tmp_path / "interrupt.log",
            timeout_seconds=10,
        )

    assert stopped == [process]


def test_final_status_exit_codes_are_distinct() -> None:
    assert harness.STATUS_NAMES == {
        0: "PASS",
        1: "TEST_FAILED",
        2: "CLEANUP_INCOMPLETE",
        3: "INFRA_FAILED",
        130: "INTERRUPTED",
    }
