import json
import logging

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
