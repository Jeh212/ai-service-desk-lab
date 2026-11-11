"""Shared contract primitives.

Every AI-facing contract carries an explicit `contract_version`. When we change
the shape of a model we bump the version so logs, traces and eval reports stay
interpretable across time (see Lab02 — AI Contracts).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

# Bump when the *shape* of the AI contracts changes.
CONTRACT_VERSION = "2024-11-a"


class Contract(BaseModel):
    """Base for all AI contracts: strict, no silent extra fields."""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        frozen=False,
        use_enum_values=False,
    )
