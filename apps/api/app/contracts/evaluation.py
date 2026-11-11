"""Evaluation contracts: cases, expectations, per-case results and run reports."""

from __future__ import annotations

from datetime import datetime

from pydantic import Field

from app.contracts.common import Contract


class EvalExpectation(Contract):
    """Ground truth for a case. All fields optional — assert only what matters."""

    intent: str | None = None
    needs_clarification: bool | None = None
    must_call: list[str] = Field(default_factory=list)
    must_not_call: list[str] = Field(default_factory=list)
    expected_state: str | None = None  # AssistantState value
    must_route_human: bool | None = None
    must_not_mutate: bool | None = None  # no proposal/execution allowed


class EvalCase(Contract):
    """One versioned evaluation case."""

    id: str
    input: str
    expected: EvalExpectation
    tags: list[str] = Field(default_factory=list)
    # Which seeded identity to run as (defaults chosen by the runner).
    as_org: str | None = None
    as_user: str | None = None
    note: str | None = None


class EvalDataset(Contract):
    name: str
    version: str
    cases: list[EvalCase]


class CheckResult(Contract):
    name: str
    passed: bool
    detail: str = ""


class EvalCaseResult(Contract):
    case_id: str
    passed: bool
    checks: list[CheckResult]
    observed_intent: str | None = None
    observed_tools: list[str] = Field(default_factory=list)
    observed_state: str | None = None
    schema_valid: bool = True
    latency_ms: float = 0.0
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    error: str | None = None


class EvalMetrics(Contract):
    total: int
    passed: int
    failed: int
    pass_rate: float
    intent_accuracy: float | None = None
    tool_selection_accuracy: float | None = None
    schema_validity_rate: float | None = None
    forbidden_action_rate: float | None = None
    correct_abstention_rate: float | None = None
    human_review_accuracy: float | None = None
    avg_latency_ms: float = 0.0
    total_prompt_tokens: int | None = None
    total_completion_tokens: int | None = None


class EvalRunReport(Contract):
    run_id: str
    dataset_name: str
    dataset_version: str
    provider: str
    model: str
    prompt_version: str
    created_at: datetime
    metrics: EvalMetrics
    results: list[EvalCaseResult]
    by_tag: dict[str, dict] = Field(default_factory=dict)
