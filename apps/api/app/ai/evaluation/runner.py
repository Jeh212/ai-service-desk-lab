"""Evaluation runner.

Runs a versioned dataset of cases through the REAL orchestrator (same code path
as production) against an isolated, in-memory seeded database, using either the
mock or Groq provider. It evaluates each case against its expectations with
specific checks — never naive string equality — and computes metrics.

Concurrency is bounded (EVAL_CONCURRENCY) so real-provider runs respect quota.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path

from app.ai.orchestrator import Orchestrator
from app.ai.prompts import library
from app.ai.providers.factory import build_provider
from app.ai.tools.registry import build_registry
from app.contracts.assistant import AssistantResponse, AssistantState
from app.contracts.evaluation import (
    CheckResult,
    EvalCase,
    EvalCaseResult,
    EvalDataset,
    EvalMetrics,
    EvalRunReport,
)
from app.contracts.messages import ChatMessageInput
from app.core.clock import utcnow
from app.core.config import Settings
from app.core.context import AuthContext, Role
from app.repositories.repos import Repositories
from app.repositories.store import Database
from app.seeds import ORG_ACME, USER_ALICE, seed_all
from app.services.container import Services


def load_dataset(path: str | Path) -> EvalDataset:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return EvalDataset(**data)


def _observed_tools(resp: AssistantResponse) -> list[str]:
    tools = []
    for step in resp.trace:
        if step.step.startswith("tool:") and step.status == "ok":
            tools.append(step.step.split(":", 1)[1])
    return tools


def _check_case(case: EvalCase, resp: AssistantResponse) -> EvalCaseResult:
    exp = case.expected
    checks: list[CheckResult] = []
    observed_intent = resp.intent.intent.value if resp.intent else None
    observed_tools = _observed_tools(resp)
    observed_state = resp.state.value

    if exp.intent is not None:
        ok = observed_intent == exp.intent
        checks.append(
            CheckResult(
                name="intent", passed=ok, detail=f"expected={exp.intent} got={observed_intent}"
            )
        )
    if exp.needs_clarification is not None:
        got = resp.intent.needs_clarification if resp.intent else False
        checks.append(
            CheckResult(
                name="needs_clarification",
                passed=got == exp.needs_clarification,
                detail=f"expected={exp.needs_clarification} got={got}",
            )
        )
    for tool in exp.must_call:
        checks.append(
            CheckResult(
                name=f"must_call:{tool}",
                passed=tool in observed_tools,
                detail=f"observed={observed_tools}",
            )
        )
    for tool in exp.must_not_call:
        checks.append(
            CheckResult(
                name=f"must_not_call:{tool}",
                passed=tool not in observed_tools,
                detail=f"observed={observed_tools}",
            )
        )
    if exp.expected_state is not None:
        checks.append(
            CheckResult(
                name="state",
                passed=observed_state == exp.expected_state,
                detail=f"expected={exp.expected_state} got={observed_state}",
            )
        )
    if exp.must_route_human is not None:
        routed = observed_state == AssistantState.HUMAN_REVIEW.value or resp.review_id is not None
        checks.append(
            CheckResult(
                name="route_human", passed=routed == exp.must_route_human, detail=f"routed={routed}"
            )
        )
    if exp.must_not_mutate:
        mutated = (
            resp.proposal is not None or observed_state == AssistantState.ACTION_COMPLETED.value
        )
        checks.append(
            CheckResult(name="no_mutation", passed=not mutated, detail=f"mutated={mutated}")
        )

    schema_valid = resp.intent is not None
    passed = all(c.passed for c in checks) and schema_valid
    total_prompt = sum(s.duration_ms for s in resp.trace)  # placeholder not used for tokens
    return EvalCaseResult(
        case_id=case.id,
        passed=passed,
        checks=checks,
        observed_intent=observed_intent,
        observed_tools=observed_tools,
        observed_state=observed_state,
        schema_valid=schema_valid,
        latency_ms=round(total_prompt, 2),
    )


class EvaluationRunner:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def run(
        self,
        dataset: EvalDataset,
        *,
        provider_name: str | None = None,
        system_version: str = library.DEFAULT_SYSTEM_VERSION,
        classifier_version: str = library.DEFAULT_CLASSIFIER_VERSION,
    ) -> EvalRunReport:
        # Each run gets a fresh, isolated, seeded in-memory DB.
        repos = Repositories(Database.in_memory())
        await seed_all(repos)
        services = Services(repos)

        settings = self._settings
        if provider_name:
            settings = settings.model_copy(update={"llm_provider": provider_name})
        provider = build_provider(settings)
        registry = build_registry()

        sem = asyncio.Semaphore(max(1, settings.eval_concurrency))

        async def run_one(case: EvalCase) -> EvalCaseResult:
            async with sem:
                orch = Orchestrator(
                    provider,
                    registry,
                    services,
                    settings,
                    system_version=system_version,
                    classifier_version=classifier_version,
                )
                auth = AuthContext(
                    org_id=case.as_org or ORG_ACME,
                    user_id=case.as_user or USER_ALICE,
                    roles=(Role.CUSTOMER,),
                )
                try:
                    resp = await orch.handle_message(auth, ChatMessageInput(message=case.input))
                    return _check_case(case, resp)
                except Exception as exc:  # noqa: BLE001 - a crash is a failed case
                    return EvalCaseResult(
                        case_id=case.id,
                        passed=False,
                        checks=[CheckResult(name="no_exception", passed=False, detail=str(exc))],
                        schema_valid=False,
                        error=str(exc),
                    )

        results = await asyncio.gather(*(run_one(c) for c in dataset.cases))
        metrics = _compute_metrics(dataset.cases, results)
        by_tag = _group_by_tag(dataset.cases, results)

        return EvalRunReport(
            run_id=f"run_{uuid.uuid4().hex[:12]}",
            dataset_name=dataset.name,
            dataset_version=dataset.version,
            provider=provider.name,
            model=provider.model,
            prompt_version=system_version,
            created_at=utcnow(),
            metrics=metrics,
            results=list(results),
            by_tag=by_tag,
        )


def _rate(num: int, den: int) -> float | None:
    return round(num / den, 4) if den else None


def _compute_metrics(cases: list[EvalCase], results: list[EvalCaseResult]) -> EvalMetrics:
    total = len(results)
    passed = sum(1 for r in results if r.passed)

    intent_den = sum(1 for c in cases if c.expected.intent is not None)
    intent_ok = sum(
        1
        for c, r in zip(cases, results, strict=False)
        if c.expected.intent is not None and r.observed_intent == c.expected.intent
    )
    tool_den = sum(1 for c in cases if c.expected.must_call or c.expected.must_not_call)
    tool_ok = sum(
        1
        for c, r in zip(cases, results, strict=False)
        if (c.expected.must_call or c.expected.must_not_call)
        and all(ch.passed for ch in r.checks if ch.name.startswith(("must_call", "must_not_call")))
    )
    schema_ok = sum(1 for r in results if r.schema_valid)

    forbidden_den = sum(1 for c in cases if c.expected.must_not_call or c.expected.must_not_mutate)
    forbidden_violations = sum(
        1
        for c, r in zip(cases, results, strict=False)
        if (c.expected.must_not_call or c.expected.must_not_mutate)
        and any(
            not ch.passed for ch in r.checks if ch.name.startswith(("must_not_call", "no_mutation"))
        )
    )
    abst_den = sum(1 for c in cases if c.expected.needs_clarification)
    abst_ok = sum(
        1
        for c, r in zip(cases, results, strict=False)
        if c.expected.needs_clarification
        and any(ch.name == "needs_clarification" and ch.passed for ch in r.checks)
    )
    human_den = sum(1 for c in cases if c.expected.must_route_human is not None)
    human_ok = sum(
        1
        for c, r in zip(cases, results, strict=False)
        if c.expected.must_route_human is not None
        and any(ch.name == "route_human" and ch.passed for ch in r.checks)
    )

    return EvalMetrics(
        total=total,
        passed=passed,
        failed=total - passed,
        pass_rate=round(passed / total, 4) if total else 0.0,
        intent_accuracy=_rate(intent_ok, intent_den),
        tool_selection_accuracy=_rate(tool_ok, tool_den),
        schema_validity_rate=_rate(schema_ok, total),
        forbidden_action_rate=_rate(forbidden_violations, forbidden_den),
        correct_abstention_rate=_rate(abst_ok, abst_den),
        human_review_accuracy=_rate(human_ok, human_den),
        avg_latency_ms=round(sum(r.latency_ms for r in results) / total, 2) if total else 0.0,
    )


def _group_by_tag(cases: list[EvalCase], results: list[EvalCaseResult]) -> dict[str, dict]:
    by_tag: dict[str, dict] = {}
    index = {r.case_id: r for r in results}
    for case in cases:
        for tag in case.tags:
            bucket = by_tag.setdefault(tag, {"total": 0, "passed": 0})
            bucket["total"] += 1
            if index[case.id].passed:
                bucket["passed"] += 1
    for bucket in by_tag.values():
        bucket["pass_rate"] = (
            round(bucket["passed"] / bucket["total"], 4) if bucket["total"] else 0.0
        )
    return by_tag
