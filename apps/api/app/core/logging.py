import json
import logging
import re
from datetime import UTC, datetime

_SECRET_PATTERNS = (
    (re.compile(r"(?i)bearer\s+[a-z0-9._~-]+"), "Bearer [REDACTED]"),
    (
        re.compile(
            r"(?i)(postgres(?:ql)?(?:\+psycopg)?://[^:\s/@]+:)"
            r"[^\s'\"]+(@(?:\[[^\]\s]+\]|[^/@\s?#]+)(?::\d+)?)(?=[/?#'\"\s]|$)"
        ),
        r"\1[REDACTED]\2",
    ),
    (
        re.compile(
            r"(?i)(?<![a-z0-9._-])([a-z0-9._-]+:)"
            r"[^\s'\"/]+(@(?:\[[^\]\s]+\]|[a-z0-9.-]+)(?::\d+)?)(?=[/'\"\s]|$)"
        ),
        r"\1[REDACTED]\2",
    ),
    (re.compile(r"\bsb_(?:secret|service_role)_[A-Za-z0-9_-]+\b"), "[REDACTED_SUPABASE_KEY]"),
    (
        re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"),
        "[REDACTED_JWT]",
    ),
)


def redact_secrets(value: str) -> str:
    for pattern, replacement in _SECRET_PATTERNS:
        value = pattern.sub(replacement, value)
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": redact_secrets(record.getMessage()),
        }
        for name in ("request_id", "method", "path", "status_code", "duration_ms"):
            value = getattr(record, name, None)
            if value is not None:
                payload[name] = value
        if record.exc_info:
            payload["exception"] = redact_secrets(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=False)


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
