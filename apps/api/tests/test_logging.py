import json
import logging
import sys
from urllib.parse import urlsplit

from app.core.logging import JsonFormatter, redact_secrets


def test_redact_secrets_covers_tokens_keys_and_database_passwords() -> None:
    raw = (
        "Bearer abc.def_ghi-jkl "
        "postgresql+psycopg://postgres:real-password@db.example/postgres "
        "sb_secret_do-not-log-this "
        "eyJheader.payload.signature"
    )

    redacted = redact_secrets(raw)

    assert "real-password" not in redacted
    assert "do-not-log-this" not in redacted
    assert "abc.def_ghi-jkl" not in redacted
    assert "eyJheader.payload.signature" not in redacted


def test_json_formatter_redacts_log_message() -> None:
    record = logging.LogRecord(
        name="test",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg="connection postgresql://user:password@database.invalid/postgres",
        args=(),
        exc_info=None,
    )

    payload = json.loads(JsonFormatter().format(record))

    assert "password" not in payload["message"]
    assert "[REDACTED]" in payload["message"]


def test_json_formatter_redacts_urlsplit_netloc_error_with_unencoded_at() -> None:
    synthetic_password = "synthetic-secret@hidden\uff0fsegment"
    database_url = f"postgresql://db_user:{synthetic_password}@db.example:5432/postgres"

    try:
        urlsplit(database_url)
    except ValueError as exc:
        record = logging.LogRecord(
            name="test",
            level=logging.ERROR,
            pathname=__file__,
            lineno=1,
            msg="database URL validation failed",
            args=(),
            exc_info=(type(exc), exc, sys.exc_info()[2]),
        )
    else:  # pragma: no cover - guards the stdlib behavior this regression test exercises
        raise AssertionError("synthetic URL must trigger urlsplit's NFKC netloc error")

    payload = json.loads(JsonFormatter().format(record))

    assert synthetic_password not in payload["exception"]
    assert "synthetic-secret" not in payload["exception"]
    assert "hidden" not in payload["exception"]
    assert "db_user:[REDACTED]@db.example:5432" in payload["exception"]


def test_redact_secrets_redacts_complete_url_with_unencoded_at_in_password() -> None:
    raw = "postgresql://db_user:synthetic-secret@hidden@db.example:5432/postgres"

    redacted = redact_secrets(raw)

    assert "synthetic-secret" not in redacted
    assert "hidden" not in redacted
    assert redacted == "postgresql://db_user:[REDACTED]@db.example:5432/postgres"


def test_startup_validation_error_is_redacted_and_hides_settings(monkeypatch, capsys) -> None:  # type: ignore[no-untyped-def]
    from app.core.config import Settings
    from app.core.logging import configure_logging

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:SYNTHETICPW@h.example:5432/db")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_SYNTHETICKEY")
    configure_logging()
    try:
        Settings(_env_file=None)  # type: ignore[call-arg]
    except Exception:
        sys.excepthook(*sys.exc_info())  # type: ignore[arg-type]
    else:  # pragma: no cover
        raise AssertionError("invalid production settings must fail")
    err = capsys.readouterr().err
    assert '"level": "CRITICAL"' in err
    assert "SYNTHETICPW" not in err and "SYNTHETICKEY" not in err and "input_value" not in err
