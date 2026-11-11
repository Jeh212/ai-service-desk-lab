"""AI Engineering Lab routes: introspection of the real backend internals.

Everything returned here is derived from the actual code (Pydantic contracts,
the live tool registry, versioned prompts) or real stored data (traces) — no
decorative mock screens.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.ai.intents.definitions import INTENT_DEFINITIONS, INTENT_DEFINITIONS_VERSION
from app.ai.orchestrator import ALLOWED_TOOLS
from app.ai.prompts import library
from app.api.deps import AuthDep, RegistryDep, ServicesDep, build_orchestrator
from app.contracts.assistant import AssistantResponse
from app.contracts.cancellation import CancellationProposal
from app.contracts.intent import IntentClassification
from app.contracts.messages import ChatMessageInput
from app.contracts.tools import ToolCall, ToolResult
from app.core.context import AuthContext

router = APIRouter(prefix="/lab", tags=["lab"])


@router.get("/intents")
async def intents(_: AuthContext = AuthDep) -> dict:
    return {
        "version": INTENT_DEFINITIONS_VERSION,
        "intents": [
            {
                "intent": intent.value,
                "description": desc,
                "allowed_tools": sorted(ALLOWED_TOOLS.get(intent, set())),
            }
            for intent, desc in INTENT_DEFINITIONS.items()
        ],
    }


@router.get("/contracts")
async def contracts(_: AuthContext = AuthDep) -> dict:
    models = {
        "IntentClassification": IntentClassification,
        "ToolCall": ToolCall,
        "ToolResult": ToolResult,
        "CancellationProposal": CancellationProposal,
        "AssistantResponse": AssistantResponse,
    }
    examples = {
        "IntentClassification": {
            "valid": {
                "intent": "cancel_subscription",
                "needs_clarification": False,
                "rationale": "Explicit request to cancel.",
                "confidence": 0.92,
                "contract_version": "2024-11-a",
            },
            "invalid": {
                "intent": "delete_everything",  # not in the enum
                "needs_clarification": "yes",  # wrong type
            },
            "invalid_reason": "intent is not a valid enum value; needs_clarification is not a bool",
        }
    }
    return {
        "contracts": [
            {"name": name, "schema": model.model_json_schema(), "examples": examples.get(name)}
            for name, model in models.items()
        ]
    }


@router.get("/tools")
async def tools(_: AuthContext = AuthDep, registry=RegistryDep) -> dict:
    return {
        "tools": [
            {
                "name": d.name,
                "description": d.description,
                "model_facing": d.model_facing,
                "allowed_roles": [r.value for r in d.allowed_roles],
                "possible_errors": [e.value for e in d.possible_errors],
                "parameters": d.args_model.json_schema(),
                "handler": d.handler.__name__,
            }
            for d in registry.all()
        ]
    }


@router.get("/prompts")
async def prompts(_: AuthContext = AuthDep) -> dict:
    return {
        "system": {v: library.system_prompt(v) for v in library.available_system_versions()},
        "default_system": library.DEFAULT_SYSTEM_VERSION,
        "classifier_versions": library.available_classifier_versions(),
        "default_classifier": library.DEFAULT_CLASSIFIER_VERSION,
    }


@router.get("/knowledge")
async def knowledge(auth: AuthContext = AuthDep, services=ServicesDep) -> dict:
    docs = await services.knowledge.list(auth)
    return {"documents": [d.model_dump(mode="json") for d in docs]}


@router.get("/traces")
async def traces(auth: AuthContext = AuthDep, services=ServicesDep, limit: int = 50) -> dict:
    items = await services.repos.traces.list(auth.org_id, limit=limit)
    return {
        "traces": [
            {
                "correlation_id": t.get("correlation_id"),
                "conversation_id": t.get("conversation_id"),
                "created_at": t.get("created_at"),
                "provider": t.get("provider"),
                "model": t.get("model"),
                "llm_calls": t.get("llm_calls"),
                "tool_calls": t.get("tool_calls"),
                "steps": len(t.get("steps", [])),
            }
            for t in items
        ]
    }


@router.get("/traces/{correlation_id}")
async def trace_detail(
    correlation_id: str, auth: AuthContext = AuthDep, services=ServicesDep
) -> dict:
    from app.core.errors import AppError, ErrorCode

    t = await services.repos.traces.get(auth.org_id, correlation_id)
    if t is None:
        raise AppError(ErrorCode.PROPOSAL_NOT_FOUND, "Trace not found.")
    return t


@router.get("/observability")
async def observability(
    auth: AuthContext = AuthDep, services=ServicesDep, limit: int = 200
) -> dict:
    items = await services.repos.traces.list(auth.org_id, limit=limit)
    total = len(items)
    llm_calls = sum(t.get("llm_calls", 0) for t in items)
    tool_calls = sum(t.get("tool_calls", 0) for t in items)
    prompt_tokens = sum(t.get("prompt_tokens", 0) for t in items)
    completion_tokens = sum(t.get("completion_tokens", 0) for t in items)
    tool_usage: dict[str, int] = {}
    errors = 0
    for t in items:
        for s in t.get("steps", []):
            if s.get("step", "").startswith("tool:"):
                name = s["step"].split(":", 1)[1]
                tool_usage[name] = tool_usage.get(name, 0) + 1
            if s.get("status") == "error":
                errors += 1
    # Rough cost estimate: Groq pricing varies; use a documented placeholder.
    est_cost = round((prompt_tokens + completion_tokens) / 1_000_000 * 0.10, 6)
    return {
        "conversations_traced": total,
        "llm_calls": llm_calls,
        "tool_calls": tool_calls,
        "validation_or_tool_errors": errors,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "estimated_cost_usd": est_cost,
        "top_tools": sorted(tool_usage.items(), key=lambda kv: kv[1], reverse=True),
    }


class PlaygroundInput(BaseModel):
    message: str
    system_version: str | None = None
    classifier_version: str | None = None


@router.post("/playground/run", response_model=AssistantResponse)
async def playground_run(
    body: PlaygroundInput,
    request: Request,
    auth: AuthContext = AuthDep,
) -> AssistantResponse:
    orchestrator = build_orchestrator(request, body.system_version, body.classifier_version)
    return await orchestrator.handle_message(auth, ChatMessageInput(message=body.message))
