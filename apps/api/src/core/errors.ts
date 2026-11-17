export const HTTP_STATUS = {
  invalid_input: 422,
  invalid_llm_output: 502,
  schema_validation_failed: 422,
  unknown_intent: 200,
  insufficient_information: 200,
  provider_error: 502,
  provider_timeout: 504,
  provider_rate_limited: 429,
  max_iterations_exceeded: 500,
  tool_not_found: 404,
  tool_not_authorized: 403,
  tool_not_available_in_state: 409,
  tool_args_invalid: 422,
  tool_execution_failed: 500,
  subscription_not_found: 404,
  policy_not_found: 404,
  cross_tenant_access: 403,
  duplicate_operation: 409,
  proposal_not_found: 404,
  proposal_expired: 410,
  proposal_mismatch: 409,
  confirmation_required: 409,
  human_review_required: 202,
  operation_not_allowed: 403,
  unauthenticated: 401,
  forbidden: 403,
  persistence_error: 500,
  internal_error: 500,
} as const;
export type ErrorCode = keyof typeof HTTP_STATUS;
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
  get status() {
    return HTTP_STATUS[this.code];
  }
  toJSON() {
    return { error: { code: this.code, message: this.message } };
  }
}
