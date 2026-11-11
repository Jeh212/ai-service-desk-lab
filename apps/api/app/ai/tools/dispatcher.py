"""ToolDispatcher — the guarded path from a model's tool request to execution.

Every tool call goes through the same ordered checks. A failure at any step is
returned as a structured ToolResult (which is also fed back to the model) and
recorded on the trace. A technical failure never becomes authorization.
"""

from __future__ import annotations

import time

from pydantic import ValidationError

from app.ai.observability.trace import StepStatus, Trace
from app.ai.tools.registry import ToolContext, ToolRegistry
from app.contracts.tools import ToolCall, ToolResult
from app.core.context import AuthContext
from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger, redact
from app.services.container import Services

logger = get_logger("ai.dispatcher")


class ToolDispatcher:
    def __init__(self, registry: ToolRegistry) -> None:
        self._registry = registry

    async def dispatch(
        self,
        call: ToolCall,
        *,
        auth: AuthContext,
        services: Services,
        trace: Trace,
        allowed: set[str] | None = None,
        conversation_id: str | None = None,
        now=None,
    ) -> ToolResult:
        start = time.perf_counter()
        trace.account_tool()

        def elapsed() -> float:
            return (time.perf_counter() - start) * 1000

        def fail(code: ErrorCode, message: str) -> ToolResult:
            duration = elapsed()
            trace.add(
                f"tool:{call.name}",
                StepStatus.ERROR,
                duration,
                {"error_code": code.value, "arguments": redact(call.arguments)},
            )
            return ToolResult.failure(call, code.value, message, duration)

        # 1) Identify the tool.
        try:
            definition = self._registry.get(call.name)
        except AppError as exc:
            return fail(exc.code, exc.message)

        # 2) Availability in the current state.
        if allowed is not None and call.name not in allowed:
            return fail(
                ErrorCode.TOOL_NOT_AVAILABLE_IN_STATE,
                f"The '{call.name}' tool is not available for this request.",
            )

        # 3) Validate arguments (structural + field constraints).
        try:
            args = definition.args_model(**call.arguments)
        except ValidationError as exc:
            duration = elapsed()
            trace.add(
                f"tool_args:{call.name}",
                StepStatus.ERROR,
                duration,
                {"errors": exc.errors(include_url=False)},
            )
            return ToolResult.failure(
                call, ErrorCode.TOOL_ARGS_INVALID.value, "Invalid tool arguments.", duration
            )

        # 4) Authorization against the verified principal.
        try:
            definition.authorize(auth)
        except AppError as exc:
            return fail(exc.code, exc.message)

        # 5) Execute the handler (domain service). 6) Record. 7) Return.
        ctx = ToolContext(auth=auth, services=services, conversation_id=conversation_id, now=now)
        try:
            data = await definition.handler(ctx, args)
        except AppError as exc:
            return fail(exc.code, exc.message)
        except Exception as exc:  # noqa: BLE001 - last-resort boundary
            logger.exception("Unexpected tool failure: %s", call.name)
            return fail(ErrorCode.TOOL_EXECUTION_FAILED, f"Tool '{call.name}' failed: {exc}")

        duration = elapsed()
        trace.add(
            f"tool:{call.name}",
            StepStatus.OK,
            duration,
            {"arguments": redact(call.arguments), "result_keys": list(data.keys())},
        )
        return ToolResult.success(call, data, duration)
