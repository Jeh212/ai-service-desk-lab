import type { Auth } from "../core/security.js";
const sensitive = new Set([
  "authorization",
  "api_key",
  "groq_api_key",
  "token",
  "secret",
  "password",
  "demo_auth_secret",
  "cookie",
  "set-cookie",
  "demo_login_code",
]);
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        sensitive.has(k.toLowerCase()) ? "***" : redact(v),
      ]),
    );
  if (typeof value === "string")
    return value
      .replace(/gsk_[A-Za-z0-9_-]+/g, "***")
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer ***");
  return value;
}
export type TraceStep = {
  step: string;
  status: "ok" | "error" | "skipped" | "abstained";
  duration_ms: number;
  detail: Record<string, unknown>;
};
export class Trace {
  steps: TraceStep[] = [];
  llm_calls = 0;
  tool_calls = 0;
  prompt_tokens = 0;
  completion_tokens = 0;
  readonly created_at = new Date().toISOString();
  constructor(
    readonly auth: Auth,
    readonly conversation_id: string | null = null,
    readonly provider = "",
    readonly model = "",
    readonly prompt_version = "",
  ) {}
  add(
    step: string,
    status: TraceStep["status"],
    duration_ms = 0,
    detail: Record<string, unknown> = {},
  ) {
    this.steps.push({
      step,
      status,
      duration_ms: Math.round(duration_ms * 100) / 100,
      detail: redact(detail) as Record<string, unknown>,
    });
  }
  account(usage: { prompt_tokens: number; completion_tokens: number }) {
    this.llm_calls++;
    this.prompt_tokens += usage.prompt_tokens;
    this.completion_tokens += usage.completion_tokens;
  }
  toJSON() {
    return {
      correlation_id: this.auth.correlation_id,
      org_id: this.auth.org_id,
      user_id: this.auth.user_id,
      conversation_id: this.conversation_id,
      created_at: this.created_at,
      provider: this.provider,
      model: this.model,
      prompt_version: this.prompt_version,
      llm_calls: this.llm_calls,
      tool_calls: this.tool_calls,
      prompt_tokens: this.prompt_tokens,
      completion_tokens: this.completion_tokens,
      steps: this.steps,
    };
  }
  view() {
    return this.steps.map((s) => ({
      ...s,
      detail:
        Object.entries(s.detail)
          .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
          .map(([k, v]) => `${k}=${v}`)
          .join(", ") || null,
    }));
  }
}
