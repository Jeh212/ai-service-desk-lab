import {
  AssistantResponse,
  IntentClassification,
  type Classification,
  type Response,
} from "../contracts/index.js";
import type { Settings } from "../core/config.js";
import { AppError } from "../core/errors.js";
import { id, type Auth } from "../core/security.js";
import { Conversation } from "../domain/models.js";
import type { Services } from "../domain/services.js";
import { ALLOWED_TOOLS } from "./intents.js";
import {
  classificationMessages,
  systemPrompt,
  DEFAULT_SYSTEM_VERSION,
  DEFAULT_CLASSIFIER_VERSION,
} from "./prompts.js";
import { LLMError, type LLMProvider, type LLMMessage } from "./providers.js";
import { ToolDispatcher, type ToolRegistry } from "./tools.js";
import { Trace } from "./trace.js";
export function parseClassification(
  text: string | null,
): Classification | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    try {
      const start = text.indexOf("{"),
        end = text.lastIndexOf("}");
      if (start < 0 || end <= start) return null;
      value = JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  const result = IntentClassification.safeParse(value);
  return result.success ? result.data : null;
}
export class Orchestrator {
  private dispatcher: ToolDispatcher;
  constructor(
    readonly provider: LLMProvider,
    private registry: ToolRegistry,
    private services: Services,
    private settings: Settings,
    private systemVersion = DEFAULT_SYSTEM_VERSION,
    private classifierVersion = DEFAULT_CLASSIFIER_VERSION,
  ) {
    this.dispatcher = new ToolDispatcher(registry);
  }
  private trace(auth: Auth, conversation_id: string) {
    return new Trace(
      auth,
      conversation_id,
      this.provider.name,
      this.provider.model,
      this.systemVersion,
    );
  }
  async classify(text: string, trace: Trace) {
    const start = performance.now();
    try {
      for (
        let attempt = 0;
        attempt <= this.settings.llm_max_retries;
        attempt++
      ) {
        const response = await this.provider.chat(
          classificationMessages(text, this.classifierVersion),
          { json_object: true, temperature: 0 },
        );
        trace.account(response.usage);
        const parsed = parseClassification(response.text);
        if (parsed) {
          trace.add("intent_classification", "ok", performance.now() - start, {
            intent: parsed.intent,
            needs_clarification: parsed.needs_clarification,
            attempts: attempt + 1,
          });
          return parsed;
        }
      }
      trace.add(
        "intent_classification",
        "abstained",
        performance.now() - start,
        { error: "invalid_json_or_schema", fallback: true },
      );
      return IntentClassification.parse({
        intent: "other",
        needs_clarification: true,
        rationale: "Could not classify the message reliably.",
      });
    } catch (error) {
      trace.add("intent_classification", "error", performance.now() - start, {
        kind: error instanceof LLMError ? error.kind : "provider_error",
      });
      throw error;
    }
  }
  async handleMessage(
    auth: Auth,
    payload: { message: string; conversation_id?: string | null },
    now = new Date(),
  ): Promise<Response> {
    let conversation = payload.conversation_id
      ? await this.services.repos.conversations.findOne({
          org_id: auth.org_id,
          conversation_id: payload.conversation_id,
        })
      : null;
    if (conversation && conversation.user_id !== auth.user_id)
      throw new AppError("cross_tenant_access", "Not your conversation.");
    if (!conversation) {
      conversation = Conversation.parse({
        conversation_id: id("conv"),
        org_id: auth.org_id,
        user_id: auth.user_id,
        messages: [],
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      });
      await this.services.repos.conversations.insert(conversation);
    }
    const trace = this.trace(auth, conversation.conversation_id);
    try {
      const classification = await this.classify(payload.message, trace);
      if (
        classification.needs_clarification ||
        classification.intent === "other"
      )
        return await this.finish(
          auth,
          conversation,
          trace,
          payload.message,
          {
            state: "needs_clarification",
            message:
              "I want to make sure I help with the right thing. Could you clarify what you'd like to do? For example: see your subscription, understand the cancellation policy, or actually cancel.",
            intent: classification,
          },
          now,
        );
      const allowed = new Set(ALLOWED_TOOLS[classification.intent]);
      const history =
        this.settings.llm_history_window > 0
          ? conversation.messages.slice(-this.settings.llm_history_window)
          : [];
      const messages: LLMMessage[] = [
        { role: "system", content: systemPrompt(this.systemVersion) },
        ...history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        { role: "user", content: payload.message },
      ];
      let proposal_id: string | null = null,
        review_id: string | null = null,
        calls = 0,
        finalText = "Here's what I found based on your account.",
        finished = false;
      outer: for (
        let iteration = 0;
        iteration < this.settings.llm_max_tool_iterations;
        iteration++
      ) {
        const response = await this.provider.chat(messages, {
          tools: this.registry.specs(allowed),
          temperature: this.settings.llm_temperature,
        });
        trace.account(response.usage);
        if (!response.tool_calls.length) {
          finalText = response.text || finalText;
          finished = true;
          break;
        }
        messages.push({
          role: "assistant",
          content: response.text ?? "",
          tool_calls: response.tool_calls,
        });
        for (const call of response.tool_calls) {
          if (++calls > 6) {
            trace.add("tool_budget", "error", 0, { limit: 6 });
            finalText =
              "I've reached the safe limit of actions for one message. Could you confirm what you'd like to do next?";
            finished = true;
            break outer;
          }
          const result = await this.dispatcher.dispatch(
            call,
            {
              auth,
              services: this.services,
              conversation_id: conversation.conversation_id,
              now,
            },
            trace,
            allowed,
          );
          if (result.ok && result.data) {
            if (
              call.name === "prepare_cancellation" &&
              typeof result.data.proposal_id === "string"
            )
              proposal_id = result.data.proposal_id;
            if (
              call.name === "request_human_review" &&
              typeof result.data.review_id === "string"
            )
              review_id = result.data.review_id;
          }
          messages.push({
            role: "tool",
            name: call.name,
            tool_call_id: call.id,
            content: JSON.stringify(
              result.ok
                ? { ok: true, data: result.data }
                : {
                    ok: false,
                    error: {
                      code: result.error_code,
                      message: result.error_message,
                    },
                  },
            ),
          });
        }
      }
      if (!finished)
        trace.add("max_iterations", "error", 0, {
          limit: this.settings.llm_max_tool_iterations,
        });
      const proposal = proposal_id
        ? await this.services.proposal(auth, proposal_id)
        : null;
      return await this.finish(
        auth,
        conversation,
        trace,
        payload.message,
        {
          state: proposal
            ? "awaiting_confirmation"
            : review_id
              ? "human_review"
              : "answered",
          message: finalText,
          intent: classification,
          proposal,
          review_id,
        },
        now,
      );
    } catch (error) {
      if (!(error instanceof LLMError)) throw error;
      trace.add("provider_failure", "error", 0, { kind: error.kind });
      return this.finish(
        auth,
        conversation,
        trace,
        payload.message,
        {
          state: "error",
          message:
            "I'm having trouble reaching the AI service right now and won't guess. Please try again in a moment, or ask to speak with a human.",
          error_code:
            error.kind === "timeout"
              ? "provider_timeout"
              : error.kind === "rate_limited"
                ? "provider_rate_limited"
                : "provider_error",
        },
        now,
      );
    }
  }
  async confirm(
    auth: Auth,
    conversation_id: string,
    proposal_id: string,
    confirm: boolean,
    now = new Date(),
  ): Promise<Response> {
    const conversation = await this.services.repos.conversations.findOne({
      org_id: auth.org_id,
      conversation_id,
    });
    if (!conversation)
      throw new AppError("proposal_not_found", "Conversation not found.");
    if (conversation.user_id !== auth.user_id)
      throw new AppError("cross_tenant_access", "Not your conversation.");
    // Both accepting and declining must pass the same identity binding.
    await this.services.proposal(auth, proposal_id);
    const trace = this.trace(auth, conversation_id);
    trace.add("confirmation", "ok", 0, { confirmed: confirm, proposal_id });
    if (!confirm) {
      await this.services.abandon(auth, proposal_id, now);
      return this.finish(
        auth,
        conversation,
        trace,
        "[confirmation:false]",
        {
          state: "answered",
          message:
            "No problem — I've cancelled that request. Your subscription is unchanged.",
        },
        now,
      );
    }
    const start = performance.now(),
      result = await this.services.execute(auth, proposal_id, now);
    trace.add("execute_cancellation", "ok", performance.now() - start, {
      audit_id: result.audit_id,
      status: result.status,
    });
    return this.finish(
      auth,
      conversation,
      trace,
      "[confirmation:true]",
      {
        state: "action_completed",
        message: `Your subscription has been cancelled, effective ${result.effective_date.slice(0, 10)}. Refund: ${(result.refund_amount_cents / 100).toFixed(2)}. Reference: ${result.audit_id}.`,
        cancellation_result: result,
      },
      now,
    );
  }
  private async finish(
    auth: Auth,
    conversation: Conversation,
    trace: Trace,
    userText: string,
    fields: Partial<Response> & Pick<Response, "state" | "message">,
    now: Date,
  ): Promise<Response> {
    const intent = fields.intent?.intent ?? null;
    await this.services.repos.append(
      auth.org_id,
      conversation.conversation_id,
      [
        {
          role: "user",
          content: userText,
          created_at: now.toISOString(),
          intent,
          correlation_id: auth.correlation_id,
        },
        {
          role: "assistant",
          content: fields.message,
          created_at: now.toISOString(),
          intent,
          correlation_id: auth.correlation_id,
        },
      ],
    );
    trace.add("assistant_response", "ok", 0, { state: fields.state });
    await this.services.repos.db.get("traces").insertOne(trace.toJSON());
    return AssistantResponse.parse({
      conversation_id: conversation.conversation_id,
      correlation_id: auth.correlation_id,
      ...fields,
      trace: trace.view(),
    });
  }
}
