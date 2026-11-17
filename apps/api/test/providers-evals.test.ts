import test from "node:test";
import assert from "node:assert/strict";
import Groq from "groq-sdk";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "groq-sdk/resources/chat/completions";
import {
  GroqLLMProvider,
  providerMessages,
  type LLMProvider,
} from "../src/ai/providers.js";
import { loadDataset, runEvaluation } from "../src/ai/evaluation.js";
import { EvalDataset } from "../src/contracts/index.js";
import { settings } from "./helpers.js";
const completion: ChatCompletion = {
  id: "test",
  object: "chat.completion",
  created: 0,
  model: "fake",
  choices: [
    {
      index: 0,
      finish_reason: "stop",
      logprobs: null,
      message: { role: "assistant", content: "hello" },
    },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
};
test("Groq structured model, tool serialization, usage and malformed argument handling", async () => {
  const sent: ChatCompletionCreateParamsNonStreaming[] = [];
  const provider = new GroqLLMProvider(settings, async (params) => {
    sent.push(params);
    return completion;
  });
  const r = await provider.chat([{ role: "user", content: "hi" }], {
    json_object: true,
  });
  assert.equal(sent[0]?.model, settings.groq_structured_model);
  assert.deepEqual(sent[0]?.response_format, { type: "json_object" });
  assert.equal(r.usage.total_tokens, 7);
  await provider.chat([{ role: "user", content: "hi" }], {
    tools: [
      {
        name: "get_subscription",
        description: "get",
        parameters: { type: "object" },
      },
    ],
  });
  assert.equal(sent[1]?.model, settings.groq_model);
  assert.equal(sent[1]?.tools?.[0]?.function?.name, "get_subscription");
  const messages = providerMessages([
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "c", name: "get_subscription", arguments: {} }],
    },
    {
      role: "tool",
      content: "{}",
      tool_call_id: "c",
      name: "get_subscription",
    },
  ]);
  assert.equal(messages[1]?.role, "tool");
  const malformed = new GroqLLMProvider(settings, async () => ({
    ...completion,
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        logprobs: null,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c",
              type: "function",
              function: { name: "get_subscription", arguments: "[" },
            },
          ],
        },
      },
    ],
  }));
  assert.deepEqual((await malformed.chat([])).tool_calls[0]?.arguments, {
    __raw__: "[",
  });
});
test("Groq 429 retries respect Retry-After and stop at configured budget", async () => {
  let calls = 0;
  const waits: number[] = [];
  const error = new Groq.RateLimitError(429, {}, "limit", {
    "retry-after": "2",
  });
  const provider = new GroqLLMProvider(
    settings,
    async () => {
      calls++;
      throw error;
    },
    async (ms) => {
      waits.push(ms);
    },
  );
  await assert.rejects(() => provider.chat([]), { kind: "rate_limited" });
  assert.equal(calls, settings.llm_max_retries + 1);
  assert.deepEqual(waits, [2000]);
});
test("Groq timeout is normalized without retries, API failures are bounded", async () => {
  let calls = 0;
  const timeout = new GroqLLMProvider(settings, async () => {
    calls++;
    throw new Groq.APIConnectionTimeoutError();
  });
  await assert.rejects(() => timeout.chat([]), { kind: "timeout" });
  assert.equal(calls, 1);
  calls = 0;
  const error = new GroqLLMProvider(
    settings,
    async () => {
      calls++;
      throw new Groq.APIConnectionError({ message: "private error" });
    },
    async () => {},
  );
  await assert.rejects(() => error.chat([]), {
    kind: "provider_error",
    message: "Groq provider request failed.",
  });
  assert.equal(calls, 2);
});
test("original 27-case evaluation dataset passes with tokens and per-tag metrics", async () => {
  const report = await runEvaluation(
    await loadDataset("service_desk_v1.json"),
    settings,
  );
  assert.equal(report.metrics.total, 27);
  assert.equal(report.metrics.pass_rate, 1);
  assert.equal(report.metrics.forbidden_action_rate, 0);
  assert.ok(report.metrics.total_prompt_tokens > 0);
  assert.ok(Object.keys(report.by_tag).length);
});
test("invalid model classification is counted as schema failure, not a successful fallback", async () => {
  const provider: LLMProvider = {
    name: "bad",
    model: "bad",
    async chat() {
      return {
        text: "bad",
        tool_calls: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        finish_reason: "stop",
        model: "bad",
      };
    },
  };
  const report = await runEvaluation(
    EvalDataset.parse({
      name: "test",
      version: "1",
      cases: [
        {
          id: "bad",
          input: "cancel",
          expected: { needs_clarification: true },
          tags: ["invalid"],
        },
      ],
    }),
    settings,
    {},
    provider,
  );
  assert.equal(report.metrics.schema_validity_rate, 0);
  assert.equal(report.metrics.failed, 1);
});
