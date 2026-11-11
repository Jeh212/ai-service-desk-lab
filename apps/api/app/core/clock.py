"""Single source of 'now'.

Returns a naive UTC datetime (tz-info stripped) so all stored/compared
datetimes in the lab share one representation. Centralizing it also makes
time-dependent logic (proposal expiry, policy windows) easy to control in tests.
"""

from __future__ import annotations

from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)
