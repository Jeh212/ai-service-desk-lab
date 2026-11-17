import test from "node:test";
import assert from "node:assert/strict";
import { fixture, auth, now, settings } from "./helpers.js";
import { Trace } from "../src/ai/trace.js";
import { ToolDispatcher, emptyArgs } from "../src/ai/tools.js";
import {
  LLMError,
  MockLLMProvider,
  type LLMProvider,
  type LLMResponse,
} from "../src/ai/providers.js";
import { Orchestrator } from "../src/ai/orchestrator.js";
for (const [name, args, allowed, code] of [
  ["unknown", {}, undefined, "tool_not_found"],
  [
    "get_billing_history",
    {},
    ["get_subscription"],
    "tool_not_available_in_state",
  ],
  ["get_billing_history", { limit: 999 }, undefined, "tool_args_invalid"],
] as const)
  test(`dispatcher: ${code}`, async () => {
    const f = await fixture();
    const r = await new ToolDispatcher(f.registry).dispatch(
      { id: "c", name, arguments: args },
      { auth: auth(), services: f.services, conversation_id: null, now },
      new Trace(auth()),
      allowed ? new Set(allowed) : undefined,
    );
    assert.equal(r.error_code, code);
  });
test("dispatcher success, role validation and safe exception boundary", async () => {
  const f = await fixture();
  const dispatcher = new ToolDispatcher(f.registry),
    ctx = { auth: auth(), services: f.services, conversation_id: null, now };
  const call = (name: string) => ({ id: "c", name, arguments: {} });
  assert.equal(
    (
      await dispatcher.dispatch(
        call("get_subscription"),
        ctx,
        new Trace(auth()),
      )
    ).ok,
    true,
  );
  f.registry.register(
    "admin_only",
    "admin",
    emptyArgs,
    async () => ({}),
    [],
    ["admin"],
  );
  assert.equal(
    (await dispatcher.dispatch(call("admin_only"), ctx, new Trace(auth())))
      .error_code,
    "tool_not_authorized",
  );
  f.registry.register("broken", "broken", emptyArgs, async () => {
    throw new Error("gsk_secret");
  });
  const r = await dispatcher.dispatch(call("broken"), ctx, new Trace(auth()));
  assert.equal(r.error_code, "tool_execution_failed");
  assert.ok(!JSON.stringify(r).includes("gsk_secret"));
});
test("informational question never prepares cancellation", async () => {
  const { orch, db } = await fixture();
  const r = await orch.handleMessage(
    auth(),
    { message: "How do I cancel?" },
    now,
  );
  assert.equal(r.state, "answered");
  assert.equal(r.proposal, null);
  assert.equal(await db.get("proposals").count({}), 0);
});
test("cancel, decline and refund workflows persist history and traces", async () => {
  const { orch, services, db } = await fixture();
  const r = await orch.handleMessage(
    auth(),
    { message: "cancel my subscription now" },
    now,
  );
  assert.equal(r.state, "awaiting_confirmation");
  const declined = await orch.confirm(
    auth(),
    r.conversation_id,
    r.proposal!.proposal_id,
    false,
    now,
  );
  assert.equal(declined.state, "answered");
  assert.equal((await services.subscription(auth())).status, "active");
  const refund = await orch.handleMessage(
    auth(),
    { message: "I want a refund" },
    now,
  );
  assert.equal(refund.state, "human_review");
  assert.ok(refund.review_id);
  assert.equal(await db.get("traces").count({}), 3);
});
test("confirmation cannot append to another user conversation", async () => {
  const { orch } = await fixture();
  const r = await orch.handleMessage(
    auth(),
    { message: "cancel my plan" },
    now,
  );
  await assert.rejects(
    () =>
      orch.confirm(
        auth("bob"),
        r.conversation_id,
        r.proposal!.proposal_id,
        true,
        now,
      ),
    { code: "cross_tenant_access" },
  );
});
const llmResponse = (
  text: string | null,
  tool_calls: LLMResponse["tool_calls"] = [],
): LLMResponse => ({
  text,
  tool_calls,
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  finish_reason: "stop",
  model: "fake",
});
test("invalid model JSON exhausts bounded retries and safely abstains", async () => {
  let calls = 0;
  const provider: LLMProvider = {
    name: "fake",
    model: "fake",
    async chat() {
      calls++;
      return llmResponse("not JSON");
    },
  };
  const { orch, db } = await fixture(provider);
  const r = await orch.handleMessage(
    auth(),
    { message: "cancel my plan" },
    now,
  );
  assert.equal(r.state, "needs_clarification");
  assert.equal(calls, settings.llm_max_retries + 1);
  assert.equal(await db.get("proposals").count({}), 0);
});
for (const kind of ["timeout", "rate_limited", "provider_error"] as const)
  test(`provider ${kind} safely fails`, async () => {
    const provider: LLMProvider = {
      name: "fake",
      model: "fake",
      async chat() {
        throw new LLMError("failure", kind);
      },
    };
    const { orch, db } = await fixture(provider);
    const r = await orch.handleMessage(
      auth(),
      { message: "cancel my plan" },
      now,
    );
    assert.equal(r.state, "error");
    assert.equal(r.proposal, null);
    assert.equal(await db.get("subscriptions").count({ status: "active" }), 2);
  });
test("malicious model cannot bypass tools allowed for information intent", async () => {
  const provider: LLMProvider = {
    name: "fake",
    model: "fake",
    async chat(_m, o) {
      return o?.json_object
        ? llmResponse('{"intent":"cancellation_info"}')
        : llmResponse(null, [
            { id: "evil", name: "prepare_cancellation", arguments: {} },
          ]);
    },
  };
  const { orch, db } = await fixture(provider);
  const r = await orch.handleMessage(
    auth(),
    { message: "How do I cancel?" },
    now,
  );
  assert.equal(r.proposal, null);
  assert.equal(await db.get("proposals").count({}), 0);
  assert.ok(
    r.trace.some((s) => s.detail?.includes("tool_not_available_in_state")),
  );
});
test("tool-call budget and iteration limit bound agent loops", async () => {
  const provider: LLMProvider = {
    name: "fake",
    model: "fake",
    async chat(_m, o) {
      return o?.json_object
        ? llmResponse('{"intent":"get_subscription"}')
        : llmResponse(
            null,
            Array.from({ length: 10 }, (_, i) => ({
              id: String(i),
              name: "get_subscription",
              arguments: {},
            })),
          );
    },
  };
  const { orch } = await fixture(provider);
  const r = await orch.handleMessage(
    auth(),
    { message: "What plan am I on?" },
    now,
  );
  assert.equal(
    r.trace.filter((s) => s.step === "tool:get_subscription").length,
    6,
  );
  assert.ok(r.trace.some((s) => s.step === "tool_budget"));
});
test("zero history window excludes earlier messages", async () => {
  const seen: string[] = [];
  const mock = new MockLLMProvider();
  const provider: LLMProvider = {
    name: "fake",
    model: "fake",
    async chat(m, o) {
      if (!o?.json_object) seen.push(...m.map((x) => x.content));
      return mock.chat(m, o);
    },
  };
  const f = await fixture(provider);
  const orch = new Orchestrator(provider, f.registry, f.services, {
    ...settings,
    llm_history_window: 0,
  });
  await orch.handleMessage(
    auth(),
    {
      conversation_id: "conv_demo_alice",
      message: "How does cancellation work?",
    },
    now,
  );
  assert.ok(!seen.some((s) => s.includes("You're on Acme Pro")));
});
