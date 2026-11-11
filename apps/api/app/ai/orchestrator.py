"""The orchestrator: one user message -> one safe assistant turn.

Pipeline:
    classify intent -> pick allowed tools -> bounded agent loop
    (model <-> dispatcher) -> determine safe state -> persist + trace.

Safety invariants enforced here, independent of the model:
* prepare_cancellation is only ever offered for an explicit cancel intent.
* The model can prepare, never execute. Execution is a separate, deterministic,
  explicitly-confirmed backend step (see confirm()).
* Invalid model output or provider failure -> safe abstention, never an action.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

from pydantic import ValidationError

from app.ai.observability.trace import StepStatus, StepTimer, Trace
from app.ai.prompts import library
from app.ai.providers.base import LLMError, LLMMessage, LLMProvider
from app.ai.tools.dispatcher import ToolDispatcher
from app.ai.tools.names import PREPARE_CANCELLATION, REQUEST_HUMAN_REVIEW
from app.ai.tools.registry import ToolRegistry
from app.contracts.assistant import AssistantResponse, AssistantState, TraceStepView
from app.contracts.cancellation import CancellationProposal
from app.contracts.intent import AssistantIntent, IntentClassification
from app.contracts.messages import ChatMessageInput
from app.contracts.tools import ToolCall
from app.core.clock import utcnow
from app.core.config import Settings
from app.core.context import AuthContext
from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.domain.models import Conversation, Message
from app.services.container import Services

logger = get_logger("ai.orchestrator")

# Which tools each intent is allowed to use. prepare_cancellation is ONLY here
# under cancel_subscription — a cancellation *question* can never reach it.
ALLOWED_TOOLS: dict[AssistantIntent, set[str]] = {
    AssistantIntent.GET_SUBSCRIPTION: {"get_subscription"},
    AssistantIntent.CANCELLATION_INFO: {"get_cancellation_policy", "search_knowledge_base"},
    AssistantIntent.CANCEL_SUBSCRIPTION: {
        "get_subscription",
        "get_cancellation_policy",
        "prepare_cancellation",
    },
    AssistantIntent.BILLING_QUESTION: {"get_billing_history"},
    AssistantIntent.REQUEST_REFUND: {"request_human_review"},
    AssistantIntent.GENERAL_SUPPORT: {"search_knowledge_base"},
    AssistantIntent.OTHER: set(),
}

MAX_TOOL_CALLS_PER_REQUEST = 6


class Orchestrator:
    def __init__(
        self,
        provider: LLMProvider,
        registry: ToolRegistry,
        services: Services,
        settings: Settings,
        system_version: str = library.DEFAULT_SYSTEM_VERSION,
        classifier_version: str = library.DEFAULT_CLASSIFIER_VERSION,
    ) -> None:
        self._provider = provider
        self._registry = registry
        self._dispatcher = ToolDispatcher(registry)
        self._services = services
        self._settings = settings
        self._system_version = system_version
        self._classifier_version = classifier_version

    # -- public API -----------------------------------------------------------

    async def handle_message(
        self, auth: AuthContext, payload: ChatMessageInput, now: datetime | None = None
    ) -> AssistantResponse:
        now = now or utcnow()
        conversation = await self._load_or_create(auth, payload.conversation_id, now)
        trace = Trace(
            correlation_id=auth.correlation_id,
            org_id=auth.org_id,
            user_id=auth.user_id,
            conversation_id=conversation.conversation_id,
            provider=self._provider.name,
            model=self._provider.model,
            prompt_version=self._system_version,
        )

        try:
            classification = await self._classify(payload.message, trace)
        except LLMError as exc:
            return await self._provider_failure(auth, conversation, trace, payload.message, exc)

        # Abstain safely when the model is unsure or out of scope.
        if classification.needs_clarification or classification.intent == AssistantIntent.OTHER:
            return await self._finish(
                auth,
                conversation,
                trace,
                payload.message,
                state=AssistantState.NEEDS_CLARIFICATION,
                message=self._clarify_text(classification),
                classification=classification,
                now=now,
            )

        allowed = ALLOWED_TOOLS.get(classification.intent, set())
        try:
            final_text, proposal_id, review_id = await self._agent_loop(
                auth, conversation, payload.message, classification, allowed, trace, now
            )
        except LLMError as exc:
            return await self._provider_failure(auth, conversation, trace, payload.message, exc)

        state, proposal, result_review_id = await self._resolve_state(auth, proposal_id, review_id)
        return await self._finish(
            auth,
            conversation,
            trace,
            payload.message,
            state=state,
            message=final_text,
            classification=classification,
            proposal=proposal,
            review_id=result_review_id,
            now=now,
        )

    async def confirm(
        self,
        auth: AuthContext,
        conversation_id: str,
        proposal_id: str,
        confirm: bool,
        now: datetime | None = None,
    ) -> AssistantResponse:
        """Deterministic confirmation step. The model is NOT involved here."""
        now = now or utcnow()
        conversation = await self._services.repos.conversations.get(auth.org_id, conversation_id)
        if conversation is None:
            raise AppError(ErrorCode.PROPOSAL_NOT_FOUND, "Conversation not found.")
        trace = Trace(
            correlation_id=auth.correlation_id,
            org_id=auth.org_id,
            user_id=auth.user_id,
            conversation_id=conversation_id,
            provider=self._provider.name,
            model=self._provider.model,
            prompt_version=self._system_version,
        )

        if not confirm:
            await self._services.repos.proposals.set_status(proposal_id, "abandoned")
            with StepTimer(trace, "confirmation") as t:
                t.detail = {"confirmed": False}
            return await self._finish(
                auth,
                conversation,
                trace,
                "[confirmation:false]",
                state=AssistantState.ANSWERED,
                message="No problem — I've cancelled that request. Your subscription is unchanged.",
                now=now,
            )

        with StepTimer(trace, "confirmation") as t:
            t.detail = {"confirmed": True, "proposal_id": proposal_id}
        with StepTimer(trace, "execute_cancellation") as t:
            result = await self._services.cancellations.execute(auth, proposal_id, now=now)
            t.detail = {"audit_id": result.audit_id, "status": result.status}

        resp = await self._finish(
            auth,
            conversation,
            trace,
            "[confirmation:true]",
            state=AssistantState.ACTION_COMPLETED,
            message=(
                f"Your subscription has been cancelled, effective "
                f"{result.effective_date.date().isoformat()}. "
                f"Refund: {result.refund_amount_cents / 100:.2f}. Reference: {result.audit_id}."
            ),
            now=now,
        )
        resp.cancellation_result = result
        return resp

    # -- steps ----------------------------------------------------------------

    async def _classify(self, user_text: str, trace: Trace) -> IntentClassification:
        messages = library.build_classification_messages(user_text, self._classifier_version)
        attempts = 0
        last_error = ""
        with StepTimer(trace, "intent_classification") as step:
            while attempts <= self._settings.llm_max_retries:
                attempts += 1
                response = await self._provider.chat(messages, json_object=True, temperature=0.0)
                trace.account_llm(response.usage.prompt_tokens, response.usage.completion_tokens)
                parsed = self._parse_classification(response.text)
                if parsed is not None:
                    step.detail = {
                        "intent": parsed.intent.value,
                        "needs_clarification": parsed.needs_clarification,
                        "attempts": attempts,
                    }
                    return parsed
                last_error = "invalid_json_or_schema"
            # Fallback: safe, non-mutating, ask for clarification.
            step.status = StepStatus.ABSTAINED
            step.detail = {"error": last_error, "fallback": True}
        return IntentClassification(
            intent=AssistantIntent.OTHER,
            needs_clarification=True,
            rationale="Could not classify the message reliably.",
            confidence=0.0,
        )

    @staticmethod
    def _parse_classification(text: str | None) -> IntentClassification | None:
        if not text:
            return None
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            # Try to salvage a JSON object embedded in text.
            start, end = text.find("{"), text.rfind("}")
            if start >= 0 and end > start:
                try:
                    data = json.loads(text[start : end + 1])
                except json.JSONDecodeError:
                    return None
            else:
                return None
        try:
            return IntentClassification(**data)
        except ValidationError:
            return None

    async def _agent_loop(
        self,
        auth: AuthContext,
        conversation: Conversation,
        user_text: str,
        classification: IntentClassification,
        allowed: set[str],
        trace: Trace,
        now: datetime,
    ) -> tuple[str, str | None, str | None]:
        messages = self._build_agent_messages(conversation, user_text)
        specs = self._registry.specs(allowed)
        proposal_id: str | None = None
        review_id: str | None = None
        tool_calls_made = 0

        for _iteration in range(self._settings.llm_max_tool_iterations):
            response = await self._provider.chat(
                messages,
                tools=specs or None,
                temperature=self._settings.llm_temperature,
            )
            trace.account_llm(response.usage.prompt_tokens, response.usage.completion_tokens)

            if not response.tool_calls:
                return (
                    response.text or self._default_reply(classification),
                    proposal_id,
                    review_id,
                )

            # Record the assistant's tool-call turn.
            messages.append(
                LLMMessage(
                    role="assistant", content=response.text or "", tool_calls=response.tool_calls
                )
            )
            for tc in response.tool_calls:
                tool_calls_made += 1
                if tool_calls_made > MAX_TOOL_CALLS_PER_REQUEST:
                    trace.add(
                        "tool_budget", StepStatus.ERROR, 0.0, {"limit": MAX_TOOL_CALLS_PER_REQUEST}
                    )
                    return (
                        "I've reached the safe limit of actions for one message. "
                        "Could you confirm what you'd like to do next?",
                        proposal_id,
                        review_id,
                    )
                result = await self._dispatcher.dispatch(
                    ToolCall(id=tc.id, name=tc.name, arguments=tc.arguments),
                    auth=auth,
                    services=self._services,
                    trace=trace,
                    allowed=allowed,
                    conversation_id=conversation.conversation_id,
                    now=now,
                )
                if result.ok and result.data:
                    if tc.name == PREPARE_CANCELLATION:
                        proposal_id = result.data.get("proposal_id", proposal_id)
                    elif tc.name == REQUEST_HUMAN_REVIEW:
                        review_id = result.data.get("review_id", review_id)
                messages.append(
                    LLMMessage(
                        role="tool",
                        name=tc.name,
                        tool_call_id=tc.id,
                        content=result.to_model_content(),
                    )
                )

        trace.add(
            "max_iterations",
            StepStatus.ERROR,
            0.0,
            {"limit": self._settings.llm_max_tool_iterations},
        )
        return (self._default_reply(classification), proposal_id, review_id)

    def _build_agent_messages(self, conversation: Conversation, user_text: str) -> list[LLMMessage]:
        messages = [LLMMessage(role="system", content=library.system_prompt(self._system_version))]
        window = self._settings.llm_history_window
        for m in conversation.messages[-window:]:
            if m.role in ("user", "assistant"):
                messages.append(LLMMessage(role=m.role, content=m.content))
        # The current user message is not yet persisted; include it explicitly.
        messages.append(LLMMessage(role="user", content=user_text))
        return messages

    async def _resolve_state(
        self, auth: AuthContext, proposal_id: str | None, review_id: str | None
    ) -> tuple[AssistantState, CancellationProposal | None, str | None]:
        if proposal_id:
            raw = await self._services.repos.proposals.get(auth.org_id, proposal_id)
            if raw:
                return AssistantState.AWAITING_CONFIRMATION, CancellationProposal(**raw), review_id
        if review_id:
            return AssistantState.HUMAN_REVIEW, None, review_id
        return AssistantState.ANSWERED, None, None

    # -- persistence / response building --------------------------------------

    async def _load_or_create(
        self, auth: AuthContext, conversation_id: str | None, now: datetime
    ) -> Conversation:
        if conversation_id:
            conv = await self._services.repos.conversations.get(auth.org_id, conversation_id)
            if conv is not None:
                if conv.user_id != auth.user_id:
                    raise AppError(ErrorCode.CROSS_TENANT_ACCESS, "Not your conversation.")
                return conv
        conv = Conversation(
            conversation_id=f"conv_{uuid.uuid4().hex[:16]}",
            org_id=auth.org_id,
            user_id=auth.user_id,
            messages=[],
            created_at=now,
            updated_at=now,
        )
        await self._services.repos.conversations.create(conv)
        return conv

    async def _finish(
        self,
        auth: AuthContext,
        conversation: Conversation,
        trace: Trace,
        user_text: str,
        *,
        state: AssistantState,
        message: str,
        classification: IntentClassification | None = None,
        proposal: CancellationProposal | None = None,
        review_id: str | None = None,
        error_code: str | None = None,
        now: datetime | None = None,
    ) -> AssistantResponse:
        now = now or utcnow()
        intent_value = classification.intent.value if classification else None
        new_messages = [
            Message(
                role="user",
                content=user_text,
                created_at=now,
                intent=intent_value,
                correlation_id=auth.correlation_id,
            ),
            Message(
                role="assistant",
                content=message,
                created_at=now,
                intent=intent_value,
                correlation_id=auth.correlation_id,
            ),
        ]
        await self._services.repos.conversations.append(
            auth.org_id, conversation.conversation_id, new_messages
        )
        trace.add("assistant_response", StepStatus.OK, 0.0, {"state": state.value})
        await self._services.repos.traces.save(trace.to_dict())

        return AssistantResponse(
            conversation_id=conversation.conversation_id,
            correlation_id=auth.correlation_id,
            state=state,
            message=message,
            intent=classification,
            proposal=proposal,
            review_id=review_id,
            error_code=error_code,
            trace=[
                TraceStepView(
                    step=s.step,
                    status=s.status.value,
                    duration_ms=s.duration_ms,
                    detail=_summarize_detail(s.detail),
                )
                for s in trace.steps
            ],
        )

    async def _provider_failure(
        self,
        auth: AuthContext,
        conversation: Conversation,
        trace: Trace,
        user_text: str,
        exc: LLMError,
    ) -> AssistantResponse:
        code = {
            "timeout": ErrorCode.PROVIDER_TIMEOUT,
            "rate_limited": ErrorCode.PROVIDER_RATE_LIMITED,
        }.get(exc.kind, ErrorCode.PROVIDER_ERROR)
        logger.warning("Provider failure (%s): %s", exc.kind, exc)
        trace.add("provider_failure", StepStatus.ERROR, 0.0, {"kind": exc.kind})
        return await self._finish(
            auth,
            conversation,
            trace,
            user_text,
            state=AssistantState.ERROR,
            message=(
                "I'm having trouble reaching the AI service right now and won't guess. "
                "Please try again in a moment, or ask to speak with a human."
            ),
            error_code=code.value,
        )

    @staticmethod
    def _clarify_text(classification: IntentClassification) -> str:
        return (
            "I want to make sure I help with the right thing. Could you clarify what "
            "you'd like to do? For example: see your subscription, understand the "
            "cancellation policy, or actually cancel."
        )

    @staticmethod
    def _default_reply(classification: IntentClassification) -> str:
        return "Here's what I found based on your account."


def _summarize_detail(detail: dict) -> str | None:
    if not detail:
        return None
    parts = []
    for k, v in detail.items():
        if isinstance(v, (str, int, float, bool)):
            parts.append(f"{k}={v}")
    return ", ".join(parts) if parts else None
