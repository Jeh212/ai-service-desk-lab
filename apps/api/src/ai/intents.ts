import data from "./prompt-data.json" with { type: "json" };
import { IntentClassification, type Intent } from "../contracts/index.js";
export const definitions = data.definitions;
export const ALLOWED_TOOLS: Record<Intent, string[]> = {
  get_subscription: ["get_subscription"],
  cancellation_info: ["get_cancellation_policy", "search_knowledge_base"],
  cancel_subscription: [
    "get_subscription",
    "get_cancellation_policy",
    "prepare_cancellation",
  ],
  billing_question: ["get_billing_history"],
  request_refund: ["request_human_review"],
  general_support: ["search_knowledge_base"],
  other: [],
};
export function classify(text: string) {
  const t = text.toLowerCase().trim(),
    has = (words: string[]) => words.some((w) => t.includes(w));
  const result = (
    intent: Intent,
    needs_clarification: boolean,
    rationale: string,
  ) =>
    IntentClassification.parse({
      intent,
      needs_clarification,
      rationale,
      confidence: needs_clarification ? 0.5 : 0.9,
    });
  if (t.length < 2)
    return result("other", true, "Empty or too short to classify.");
  if (has(data._REFUND))
    return result("request_refund", false, "Mentions a refund/estorno.");
  const question = has(data._QUESTION_CUES);
  if (t.includes("cancel")) {
    if (has(data._ACTION_CUES) && !/\bhow\b|\bcomo\b/.test(t))
      return result(
        "cancel_subscription",
        false,
        "Explicit request to cancel now.",
      );
    if (question)
      return result(
        "cancellation_info",
        false,
        "Asking how cancellation works (informational).",
      );
    return result(
      "cancellation_info",
      true,
      "Ambiguous cancellation mention; defaulting to info and flagging clarification.",
    );
  }
  if (has(data._BILLING))
    return result("billing_question", false, "Mentions billing/charges.");
  if (has(data._SUBSCRIPTION))
    return result("get_subscription", false, "Asks about subscription/plan.");
  if (question)
    return result("general_support", false, "General support question.");
  return result("other", false, "No specific intent matched.");
}
