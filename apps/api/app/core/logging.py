"""Structured logging with correlation ids and secret redaction.

Traces and logs must never contain API keys, auth tokens or other secrets.
`redact()` is applied to any dict before it is attached to a log record.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

from pythonjsonlogger import jsonlogger

from app.core.config import get_settings

_SENSITIVE_KEYS = {
    "authorization",
    "api_key",
    "groq_api_key",
    "token",
    "secret",
    "password",
    "demo_auth_secret",
    "cookie",
    "set-cookie",
}


def redact(value: Any) -> Any:
    """Recursively replace sensitive values with '***'."""
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if isinstance(k, str) and k.lower() in _SENSITIVE_KEYS:
                out[k] = "***"
            else:
                out[k] = redact(v)
        return out
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    return value


_configured = False


def configure_logging() -> None:
    global _configured
    if _configured:
        return
    settings = get_settings()
    handler = logging.StreamHandler(sys.stdout)
    if settings.log_json:
        fmt = jsonlogger.JsonFormatter(
            "%(asctime)s %(levelname)s %(name)s %(message)s",
            rename_fields={"asctime": "ts", "levelname": "level", "name": "logger"},
        )
    else:
        fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(name)s | %(message)s")
    handler.setFormatter(fmt)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(settings.log_level.upper())
    # Quiet noisy third-party loggers.
    logging.getLogger("pymongo").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    _configured = True


def get_logger(name: str) -> logging.Logger:
    configure_logging()
    return logging.getLogger(name)
