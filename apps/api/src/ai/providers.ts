import Groq from "groq-sdk";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "groq-sdk/resources/chat/completions";
import { setTimeout as sleep } from "node:timers/promises";
import type { Settings } from "../core/config.js";
import { id } from "../core/security.js";
import type { Call, Intent } from "../contracts/index.js";
import { classify } from "./intents.js";
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Call[];
  tool_call_id?: string;
  name?: string;
}
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
export interface LLMResponse {
  text: string | null;
  tool_calls: Call[];
  usage: Usage;
  finish_reason: string;
  model: string;
}
export interface ChatOptions {
  tools?: ToolSpec[];
  json_object?: boolean;
  temperature?: number;
  max_tokens?: number;
  model?: string;
}
export interface LLMProvider {
  name: string;
  model: string;
  chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse>;
}
export class LLMError extends Error {
  constructor(
    message: string,
    readonly kind:
      "timeout" | "rate_limited" | "provider_error" = "provider_error",
  ) {
    super(message);
  }
}
const plans: Record<Intent, string[]> = {
  get_subscription: ["get_subscription"],
  cancellation_info: ["get_cancellation_policy"],
  cancel_subscription: ["get_subscription", "prepare_cancellation"],
  billing_question: ["get_billing_history"],
  request_refund: ["request_human_review"],
  general_support: ["search_knowledge_base"],
  other: [],
};
const finalText: Record<Intent, string> = {
  get_subscription: "Here are the details of your subscription.",
  cancellation_info:
    "Here is how cancellation works under your plan's policy. Let me know if you'd like to go ahead and cancel.",
  cancel_subscription:
    "I've prepared the cancellation with the exact terms. Please review and confirm to proceed.",
  billing_question: "Here is your recent billing history.",
  request_refund:
    "I've routed your refund request to a human specialist who will review it.",
  general_support: "Here's what I found that should help.",
  other:
    "I'm not sure I can help with that. Could you rephrase, or I can connect you with a human agent?",
};
export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";
  readonly model = "mock-rules-v1";
  async chat(
    messages: LLMMessage[],
    options: ChatOptions = {},
  ): Promise<LLMResponse> {
    const userText =
      [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const classification = classify(userText);
    const response: LLMResponse = {
      text: null,
      tool_calls: [],
      usage: { prompt_tokens: 42, completion_tokens: 16, total_tokens: 58 },
      finish_reason: "stop",
      model: this.model,
    };
    if (options.json_object)
      return { ...response, text: JSON.stringify(classification) };
    const available = new Set(options.tools?.map((t) => t.name));
    const executed = messages.filter((m) => m.role === "tool");
    for (const name of plans[classification.intent]) {
      if (!available.has(name) || executed.some((m) => m.name === name))
        continue;
      let args: Record<string, unknown> = {};
      if (name === "prepare_cancellation") {
        for (const m of executed) {
          try {
            const payload = JSON.parse(m.content) as {
              data?: { subscription_id?: string };
            };
            if (payload.data?.subscription_id) {
              args = { subscription_id: payload.data.subscription_id };
              break;
            }
          } catch {
            /* Ignore malformed tool payloads. */
          }
        }
      } else if (name === "request_human_review")
        args = {
          reason: "refund_request",
          summary: `Customer requested a refund: ${userText.slice(0, 200)}`,
        };
      else if (name === "get_billing_history") args = { limit: 10 };
      else if (name === "search_knowledge_base")
        args = { query: userText.slice(0, 120) };
      return {
        ...response,
        finish_reason: "tool_calls",
        tool_calls: [{ id: id("call"), name, arguments: args }],
      };
    }
    // Never claim that a failed tool succeeded, including in offline demonstrations.
    for (const message of executed) {
      try {
        const result = JSON.parse(message.content) as {
          ok: boolean;
          error?: { message: string };
        };
        if (!result.ok)
          return {
            ...response,
            text:
              result.error?.message ?? "The operation could not be completed.",
          };
      } catch {
        /* Continue to safe default. */
      }
    }
    return { ...response, text: finalText[classification.intent] };
  }
}
export function providerMessages(
  messages: LLMMessage[],
): ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role === "tool")
      return {
        role: "tool",
        tool_call_id: m.tool_call_id ?? "",
        content: m.content,
      };
    if (m.role === "assistant")
      return {
        role: "assistant",
        content: m.content,
        ...(m.tool_calls?.length
          ? {
              tool_calls: m.tool_calls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: {
                  name: c.name,
                  arguments: JSON.stringify(c.arguments),
                },
              })),
            }
          : {}),
      };
    return { role: m.role, content: m.content };
  });
}
export type GroqTransport = (
  params: ChatCompletionCreateParamsNonStreaming,
) => Promise<ChatCompletion>;
export class GroqLLMProvider implements LLMProvider {
  readonly name = "groq";
  readonly model: string;
  private send: GroqTransport;
  constructor(
    private settings: Settings,
    transport?: GroqTransport,
    private wait: (ms: number) => Promise<unknown> = sleep,
  ) {
    this.model = settings.groq_model;
    if (transport) this.send = transport;
    else {
      if (!settings.groq_api_key)
        throw new Error("LLM_PROVIDER=groq but GROQ_API_KEY is not set.");
      const client = new Groq({
        apiKey: settings.groq_api_key,
        timeout: settings.llm_timeout_seconds * 1000,
        maxRetries: 0,
      });
      this.send = (params) => client.chat.completions.create(params);
    }
  }
  async chat(
    messages: LLMMessage[],
    options: ChatOptions = {},
  ): Promise<LLMResponse> {
    const model =
      options.model ??
      (options.json_object ? this.settings.groq_structured_model : this.model);
    const params: ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: providerMessages(messages),
      temperature: options.temperature ?? this.settings.llm_temperature,
      max_tokens: options.max_tokens ?? this.settings.llm_max_tokens,
      stream: false,
    };
    if (options.json_object) params.response_format = { type: "json_object" };
    if (options.tools?.length) {
      params.tools = options.tools.map((t) => ({
        type: "function",
        function: t,
      }));
      params.tool_choice = "auto";
    }
    let completion: ChatCompletion;
    for (let attempt = 0; ; attempt++) {
      try {
        completion = await this.send(params);
        break;
      } catch (error) {
        if (error instanceof Groq.APIConnectionTimeoutError)
          throw new LLMError("Groq request timed out.", "timeout");
        const limited = error instanceof Groq.RateLimitError;
        if (attempt >= this.settings.llm_max_retries)
          throw new LLMError(
            limited
              ? "Groq rate limit exceeded."
              : "Groq provider request failed.",
            limited ? "rate_limited" : "provider_error",
          );
        const header =
          error instanceof Groq.APIError
            ? error.headers?.["retry-after"]
            : null;
        const seconds = header ? Number(header) : NaN;
        const dateDelay = header
          ? (Date.parse(header) - Date.now()) / 1000
          : NaN;
        const delay = Number.isFinite(seconds)
          ? seconds
          : Number.isFinite(dateDelay)
            ? dateDelay
            : 2 ** attempt;
        await this.wait(Math.max(0, Math.min(delay, 10)) * 1000);
      }
    }
    const choice = completion.choices[0];
    if (!choice) throw new LLMError("Groq returned no completion.");
    const tool_calls = (choice.message.tool_calls ?? []).map((tc) => {
      let args: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(tc.function.arguments || "{}");
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("Expected object");
        args = value as Record<string, unknown>;
      } catch {
        args = { __raw__: tc.function.arguments };
      }
      return { id: tc.id, name: tc.function.name, arguments: args };
    });
    return {
      text: choice.message.content,
      tool_calls,
      usage: {
        prompt_tokens: completion.usage?.prompt_tokens ?? 0,
        completion_tokens: completion.usage?.completion_tokens ?? 0,
        total_tokens: completion.usage?.total_tokens ?? 0,
      },
      finish_reason: choice.finish_reason,
      model,
    };
  }
}
export function buildProvider(settings: Settings): LLMProvider {
  return settings.llm_provider === "groq"
    ? new GroqLLMProvider(settings)
    : new MockLLMProvider();
}
