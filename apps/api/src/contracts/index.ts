import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
export const CONTRACT_VERSION = "2024-11-a";
export const text = z.string().trim();
export const timestamp = z.string().datetime({ offset: true });
export const jsonObject = z.record(z.unknown());
export const intentNames = [
  "get_subscription",
  "cancellation_info",
  "cancel_subscription",
  "request_refund",
  "billing_question",
  "general_support",
  "other",
] as const;
export type Intent = (typeof intentNames)[number];
export const IntentClassification = z
  .object({
    intent: z.enum(intentNames),
    needs_clarification: z.boolean().default(false),
    rationale: text.max(400).default(""),
    confidence: z.number().min(0).max(1).default(0),
    contract_version: text.default(CONTRACT_VERSION),
  })
  .strict();
export type Classification = z.infer<typeof IntentClassification>;
export const ChatMessageInput = z
  .object({
    conversation_id: text.nullable().default(null),
    message: text.min(1).max(4000),
  })
  .strict();
export const ConfirmActionInput = z
  .object({
    conversation_id: text.min(1),
    proposal_id: text.min(1),
    confirm: z.boolean(),
  })
  .strict();
export const CancellationTerms = z
  .object({
    effective_date: timestamp,
    refund_amount_cents: z.number().int().nonnegative().default(0),
    currency: text.default("USD"),
    retains_access_until: timestamp.nullable().default(null),
    penalty_cents: z.number().int().nonnegative().default(0),
    policy_id: text,
    policy_version: z.number().int(),
    summary: text,
  })
  .strict();
export const CancellationProposal = z
  .object({
    proposal_id: text,
    org_id: text,
    user_id: text,
    subscription_id: text,
    status: z
      .enum(["pending", "confirmed", "executed", "expired", "abandoned"])
      .default("pending"),
    terms: CancellationTerms,
    created_at: timestamp,
    expires_at: timestamp,
    contract_version: text.default(CONTRACT_VERSION),
  })
  .strict();
export type Proposal = z.infer<typeof CancellationProposal>;
export const CancellationResult = z
  .object({
    proposal_id: text,
    subscription_id: text,
    status: text,
    effective_date: timestamp,
    refund_amount_cents: z.number().int(),
    audit_id: text,
    executed_at: timestamp,
  })
  .strict();
export const reviewReasons = [
  "refund_request",
  "policy_exception",
  "inconsistent_data",
  "approval_required",
  "eligibility_uncertain",
] as const;
export const HumanReviewRequest = z
  .object({
    review_id: text,
    org_id: text,
    user_id: text,
    conversation_id: text.nullable().default(null),
    reason: z.enum(reviewReasons),
    summary: text.max(1000),
    context: jsonObject.default({}),
    status: z.enum(["pending", "approved", "rejected"]).default("pending"),
    created_at: timestamp,
    decided_at: timestamp.nullable().default(null),
    decided_by: text.nullable().default(null),
    decision_note: text.nullable().default(null),
  })
  .strict();
export const ReviewDecisionInput = z
  .object({ approve: z.boolean(), note: text.max(1000).default("") })
  .strict();
export const ToolCall = z
  .object({ id: text, name: text, arguments: jsonObject.default({}) })
  .strict();
export type Call = z.infer<typeof ToolCall>;
export const ToolResult = z
  .object({
    tool_call_id: text,
    name: text,
    ok: z.boolean(),
    data: jsonObject.nullable().default(null),
    error_code: text.nullable().default(null),
    error_message: text.nullable().default(null),
    duration_ms: z.number().default(0),
  })
  .strict();
export type Result = z.infer<typeof ToolResult>;
export const AssistantResponse = z
  .object({
    conversation_id: text,
    correlation_id: text,
    state: z.enum([
      "answered",
      "needs_clarification",
      "awaiting_confirmation",
      "action_completed",
      "human_review",
      "error",
    ]),
    message: text,
    intent: IntentClassification.nullable().default(null),
    proposal: CancellationProposal.nullable().default(null),
    cancellation_result: CancellationResult.nullable().default(null),
    review_id: text.nullable().default(null),
    error_code: text.nullable().default(null),
    trace: z
      .array(
        z
          .object({
            step: text,
            status: text,
            duration_ms: z.number(),
            detail: text.nullable().default(null),
          })
          .strict(),
      )
      .default([]),
    contract_version: text.default(CONTRACT_VERSION),
  })
  .strict();
export type Response = z.infer<typeof AssistantResponse>;
export const EvalExpectation = z
  .object({
    intent: text.nullable().default(null),
    needs_clarification: z.boolean().nullable().default(null),
    must_call: z.array(text).default([]),
    must_not_call: z.array(text).default([]),
    expected_state: text.nullable().default(null),
    must_route_human: z.boolean().nullable().default(null),
    must_not_mutate: z.boolean().nullable().default(null),
  })
  .strict();
export const EvalCase = z
  .object({
    id: text,
    input: text,
    expected: EvalExpectation,
    tags: z.array(text).default([]),
    as_org: text.nullable().default(null),
    as_user: text.nullable().default(null),
    note: text.nullable().default(null),
  })
  .strict();
export const EvalDataset = z
  .object({ name: text, version: text, cases: z.array(EvalCase) })
  .strict();
export type Dataset = z.infer<typeof EvalDataset>;
export function jsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return zodToJsonSchema(schema, { $refStrategy: "none" });
}
