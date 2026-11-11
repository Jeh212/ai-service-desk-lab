"""Internal, consistent error codes and the application exception type.

Every failure boundary in the system maps to one of these codes. The API layer
translates them into HTTP responses; the orchestrator uses them to decide
between retry, fallback and safe abstention. A technical failure is NEVER
interpreted as authorization to perform an action.
"""

from __future__ import annotations

from enum import Enum


class ErrorCode(str, Enum):
    # Input / contract
    INVALID_INPUT = "invalid_input"
    INVALID_LLM_OUTPUT = "invalid_llm_output"
    SCHEMA_VALIDATION_FAILED = "schema_validation_failed"
    UNKNOWN_INTENT = "unknown_intent"
    INSUFFICIENT_INFORMATION = "insufficient_information"

    # Provider
    PROVIDER_ERROR = "provider_error"
    PROVIDER_TIMEOUT = "provider_timeout"
    PROVIDER_RATE_LIMITED = "provider_rate_limited"
    MAX_ITERATIONS_EXCEEDED = "max_iterations_exceeded"

    # Tools
    TOOL_NOT_FOUND = "tool_not_found"
    TOOL_NOT_AUTHORIZED = "tool_not_authorized"
    TOOL_NOT_AVAILABLE_IN_STATE = "tool_not_available_in_state"
    TOOL_ARGS_INVALID = "tool_args_invalid"
    TOOL_EXECUTION_FAILED = "tool_execution_failed"

    # Domain
    SUBSCRIPTION_NOT_FOUND = "subscription_not_found"
    POLICY_NOT_FOUND = "policy_not_found"
    CROSS_TENANT_ACCESS = "cross_tenant_access"
    DUPLICATE_OPERATION = "duplicate_operation"
    PROPOSAL_NOT_FOUND = "proposal_not_found"
    PROPOSAL_EXPIRED = "proposal_expired"
    PROPOSAL_MISMATCH = "proposal_mismatch"
    CONFIRMATION_REQUIRED = "confirmation_required"
    HUMAN_REVIEW_REQUIRED = "human_review_required"
    OPERATION_NOT_ALLOWED = "operation_not_allowed"

    # Auth
    UNAUTHENTICATED = "unauthenticated"
    FORBIDDEN = "forbidden"

    # Persistence / unknown
    PERSISTENCE_ERROR = "persistence_error"
    INTERNAL_ERROR = "internal_error"


# Suggested HTTP status for each code (used by the API exception handler).
HTTP_STATUS: dict[ErrorCode, int] = {
    ErrorCode.INVALID_INPUT: 422,
    ErrorCode.INVALID_LLM_OUTPUT: 502,
    ErrorCode.SCHEMA_VALIDATION_FAILED: 422,
    ErrorCode.UNKNOWN_INTENT: 200,
    ErrorCode.INSUFFICIENT_INFORMATION: 200,
    ErrorCode.PROVIDER_ERROR: 502,
    ErrorCode.PROVIDER_TIMEOUT: 504,
    ErrorCode.PROVIDER_RATE_LIMITED: 429,
    ErrorCode.MAX_ITERATIONS_EXCEEDED: 500,
    ErrorCode.TOOL_NOT_FOUND: 404,
    ErrorCode.TOOL_NOT_AUTHORIZED: 403,
    ErrorCode.TOOL_NOT_AVAILABLE_IN_STATE: 409,
    ErrorCode.TOOL_ARGS_INVALID: 422,
    ErrorCode.TOOL_EXECUTION_FAILED: 500,
    ErrorCode.SUBSCRIPTION_NOT_FOUND: 404,
    ErrorCode.POLICY_NOT_FOUND: 404,
    ErrorCode.CROSS_TENANT_ACCESS: 403,
    ErrorCode.DUPLICATE_OPERATION: 409,
    ErrorCode.PROPOSAL_NOT_FOUND: 404,
    ErrorCode.PROPOSAL_EXPIRED: 410,
    ErrorCode.PROPOSAL_MISMATCH: 409,
    ErrorCode.CONFIRMATION_REQUIRED: 409,
    ErrorCode.HUMAN_REVIEW_REQUIRED: 202,
    ErrorCode.OPERATION_NOT_ALLOWED: 403,
    ErrorCode.UNAUTHENTICATED: 401,
    ErrorCode.FORBIDDEN: 403,
    ErrorCode.PERSISTENCE_ERROR: 500,
    ErrorCode.INTERNAL_ERROR: 500,
}


class AppError(Exception):
    """Base application error carrying a stable internal code.

    `message` is safe to show to a client. `detail` is extra context for logs
    and must never contain secrets.
    """

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        detail: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail or {}

    @property
    def http_status(self) -> int:
        return HTTP_STATUS.get(self.code, 500)

    def to_public_dict(self) -> dict:
        return {"error": {"code": self.code.value, "message": self.message}}


# Convenience factories for the most common boundaries ------------------------


def cross_tenant(resource: str) -> AppError:
    return AppError(
        ErrorCode.CROSS_TENANT_ACCESS,
        "You are not allowed to access this resource.",
        detail={"resource": resource},
    )


def not_found(code: ErrorCode, resource: str) -> AppError:
    return AppError(code, f"{resource} was not found.", detail={"resource": resource})
