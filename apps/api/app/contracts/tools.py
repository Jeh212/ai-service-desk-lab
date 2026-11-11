"""Generic tool-calling contracts.

Per-tool argument/result schemas live next to their handlers in
app/ai/tools/schemas.py. These generic envelopes describe a tool *call* (what
the model asked for) and a tool *result* (what the backend returns), including
the error path. The dispatcher validates arguments against the per-tool schema
before anything runs.
"""

from __future__ import annotations

from typing import Any

from pydantic import Field

from app.contracts.common import Contract


class ToolCall(Contract):
    """A single tool invocation requested by the model."""

    id: str = Field(description="Provider-assigned tool-call id, echoed back in the result.")
    name: str = Field(description="Registered tool name.")
    arguments: dict[str, Any] = Field(
        default_factory=dict,
        description="Raw arguments from the model, validated before execution.",
    )


class ToolResult(Contract):
    """The outcome of executing one tool call."""

    tool_call_id: str
    name: str
    ok: bool
    data: dict[str, Any] | None = None
    error_code: str | None = None
    error_message: str | None = None
    duration_ms: float = 0.0

    @classmethod
    def success(cls, call: ToolCall, data: dict[str, Any], duration_ms: float) -> ToolResult:
        return cls(
            tool_call_id=call.id,
            name=call.name,
            ok=True,
            data=data,
            duration_ms=duration_ms,
        )

    @classmethod
    def failure(
        cls,
        call: ToolCall,
        error_code: str,
        error_message: str,
        duration_ms: float = 0.0,
    ) -> ToolResult:
        return cls(
            tool_call_id=call.id,
            name=call.name,
            ok=False,
            error_code=error_code,
            error_message=error_message,
            duration_ms=duration_ms,
        )

    def to_model_content(self) -> str:
        """Compact JSON string returned to the model as the tool's output."""
        import json

        if self.ok:
            return json.dumps({"ok": True, "data": self.data}, default=str)
        return json.dumps(
            {"ok": False, "error": {"code": self.error_code, "message": self.error_message}}
        )
