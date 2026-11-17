import test from "node:test";
import assert from "node:assert/strict";
import {
  IntentClassification,
  ChatMessageInput,
  ConfirmActionInput,
  jsonSchema,
} from "../src/contracts/index.js";
import { billingArgs, reviewArgs } from "../src/ai/tools.js";
import { classify } from "../src/ai/intents.js";
import { parseClassification } from "../src/ai/orchestrator.js";
const cases = [
  ["How do I cancel my plan?", "cancellation_info"],
  ["What happens if I cancel?", "cancellation_info"],
  ["Como funciona o cancelamento?", "cancellation_info"],
  ["I want to cancel my subscription now", "cancel_subscription"],
  ["Please cancel my plan today", "cancel_subscription"],
  ["Quero cancelar minha assinatura agora", "cancel_subscription"],
  ["I'd like a refund", "request_refund"],
  ["Quero um reembolso", "request_refund"],
  ["What plan am I on?", "get_subscription"],
  ["Why was I charged twice?", "billing_question"],
  ["Hello", "other"],
  ["I want to cancel now but first, how does it work?", "cancellation_info"],
];
for (const [input, intent] of cases)
  test(`intent: ${input}`, () => assert.equal(classify(input!).intent, intent));
test("bare cancel asks for clarification", () =>
  assert.equal(classify("cancel").needs_clarification, true));
test("valid classification supplies defaults and version", () => {
  const c = IntentClassification.parse({ intent: "cancel_subscription" });
  assert.equal(c.needs_clarification, false);
  assert.equal(c.contract_version, "2024-11-a");
});
for (const bad of [
  { intent: "delete_everything" },
  { intent: "other", surprise: "x" },
  { intent: "other", confidence: 1.5 },
  { intent: "other", needs_clarification: "yes" },
])
  test(`reject invalid contract ${JSON.stringify(bad)}`, () =>
    assert.equal(IntentClassification.safeParse(bad).success, false));
test("request and tool schemas reject extra fields, coercions and invalid limits", () => {
  assert.equal(billingArgs.safeParse({ limit: 999 }).success, false);
  assert.equal(billingArgs.safeParse({ limit: "10" }).success, false);
  assert.equal(
    reviewArgs.safeParse({ reason: "refund_request", summary: "x", extra: "y" })
      .success,
    false,
  );
  assert.equal(ChatMessageInput.safeParse({ message: "   " }).success, false);
  assert.equal(
    ConfirmActionInput.safeParse({
      conversation_id: "c",
      proposal_id: "p",
      confirm: "true",
    }).success,
    false,
  );
  assert.equal(jsonSchema(billingArgs).additionalProperties, false);
});
test("classification parsing handles fenced JSON and malformed values safely", () => {
  assert.equal(
    parseClassification('```json\n{"intent":"other"}\n```')?.intent,
    "other",
  );
  for (const value of ["bad", "null", "[]", '{"intent":"invalid"}', null])
    assert.equal(parseClassification(value), null);
});
