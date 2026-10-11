from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

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
