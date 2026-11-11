"""Request tracing for the AI pipeline.

A Trace is the ordered list of steps a single user message goes through:

    User Message -> Intent -> Tool Call -> Args Validation -> Tool Execution
    -> Tool Result -> Business Rule -> Assistant Response

Each step records a status, duration and a *redacted* detail payload. Secrets
(API keys, tokens) are never written to a trace.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any

from app.core.clock import utcnow
from app.core.logging import redact


class StepStatus(str, Enum):
    OK = "ok"
    ERROR = "error"
    SKIPPED = "skipped"
    ABSTAINED = "abstained"


@dataclass
class TraceStep:
    step: str
    status: StepStatus
    duration_ms: float
    detail: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "step": self.step,
            "status": self.status.value,
            "duration_ms": round(self.duration_ms, 2),
            "detail": self.detail,
        }


@dataclass
class Trace:
    correlation_id: str
    org_id: str
    user_id: str
    conversation_id: str | None = None
    created_at: datetime = field(default_factory=utcnow)
    steps: list[TraceStep] = field(default_factory=list)
    # Aggregates surfaced to the Observability screen.
    llm_calls: int = 0
    tool_calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    provider: str = ""
    model: str = ""
    prompt_version: str = ""

    def add(
        self,
        step: str,
        status: StepStatus,
        duration_ms: float,
        detail: dict | None = None,
    ) -> None:
        self.steps.append(TraceStep(step, status, duration_ms, redact(detail or {})))

    def account_llm(self, prompt_tokens: int = 0, completion_tokens: int = 0) -> None:
        self.llm_calls += 1
        self.prompt_tokens += prompt_tokens or 0
        self.completion_tokens += completion_tokens or 0

    def account_tool(self) -> None:
        self.tool_calls += 1

    def to_dict(self) -> dict:
        return {
            "correlation_id": self.correlation_id,
            "org_id": self.org_id,
            "user_id": self.user_id,
            "conversation_id": self.conversation_id,
            "created_at": self.created_at.isoformat(),
            "provider": self.provider,
            "model": self.model,
            "prompt_version": self.prompt_version,
            "llm_calls": self.llm_calls,
            "tool_calls": self.tool_calls,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "steps": [s.to_dict() for s in self.steps],
        }


class StepTimer:
    """Context manager that appends a timed step to a trace.

    Usage:
        with StepTimer(trace, "intent_classification") as t:
            ...
            t.detail = {"intent": "cancel_subscription"}
    """

    def __init__(self, trace: Trace, step: str) -> None:
        self.trace = trace
        self.step = step
        self.detail: dict = {}
        self.status = StepStatus.OK
        self._start = 0.0

    def __enter__(self) -> StepTimer:
        self._start = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        duration = (time.perf_counter() - self._start) * 1000
        if exc_type is not None:
            self.status = StepStatus.ERROR
            self.detail = {**self.detail, "exception": str(exc)}
        self.trace.add(self.step, self.status, duration, self.detail)
        return False  # never suppress exceptions
