// Typed client for the AI Service Desk API.
//
// Types are hand-written to mirror the backend Pydantic contracts. For a fully
// generated client, run `npm run gen:api` (openapi-typescript against the live
// /openapi.json) — see README. We keep this thin client for reliability and to
// avoid a codegen step just to study the app.

import { getToken } from "./session";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

export type Role = "customer" | "agent" | "admin";

export interface User {
  user_id: string;
  org_id: string;
  name: string;
  email: string;
  roles: Role[];
}

export type AssistantState =
  | "answered"
  | "needs_clarification"
  | "awaiting_confirmation"
  | "action_completed"
  | "human_review"
  | "error";

export interface IntentClassification {
  intent: string;
  needs_clarification: boolean;
  rationale: string;
  confidence: number;
  contract_version: string;
}

export interface TraceStepView {
  step: string;
  status: string;
  duration_ms: number;
  detail: string | null;
}

export interface CancellationProposal {
  proposal_id: string;
  subscription_id: string;
  status: string;
  expires_at: string;
  terms: {
    effective_date: string;
    refund_amount_cents: number;
    penalty_cents: number;
    currency: string;
    summary: string;
    policy_version: number;
  };
}

export interface AssistantResponse {
  conversation_id: string;
  correlation_id: string;
  state: AssistantState;
  message: string;
  intent: IntentClassification | null;
  proposal: CancellationProposal | null;
  cancellation_result: Record<string, unknown> | null;
  review_id: string | null;
  error_code: string | null;
  trace: TraceStepView[];
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) headers["authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = data?.error ?? { code: "http_error", message: res.statusText };
    throw new ApiError(res.status, err.code, err.message);
  }
  return data as T;
}

export const api = {
  login: (login_code: string) =>
    request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ login_code }),
    }),
  me: () => request<User & { correlation_id: string }>("/auth/me"),

  sendMessage: (message: string, conversation_id?: string) =>
    request<AssistantResponse>("/chat/messages", {
      method: "POST",
      body: JSON.stringify({ message, conversation_id }),
    }),
  confirm: (conversation_id: string, proposal_id: string, confirm: boolean) =>
    request<AssistantResponse>("/chat/confirm", {
      method: "POST",
      body: JSON.stringify({ conversation_id, proposal_id, confirm }),
    }),
  conversations: () => request<any[]>("/chat/conversations"),
  conversation: (id: string) => request<any>(`/chat/conversations/${id}`),

  subscription: () => request<any>("/me/subscription"),
  billing: () => request<{ charges: any[] }>("/me/billing"),

  intents: () => request<any>("/lab/intents"),
  contracts: () => request<any>("/lab/contracts"),
  tools: () => request<any>("/lab/tools"),
  prompts: () => request<any>("/lab/prompts"),
  knowledge: () => request<any>("/lab/knowledge"),
  traces: () => request<any>("/lab/traces"),
  trace: (cid: string) => request<any>(`/lab/traces/${cid}`),
  observability: () => request<any>("/lab/observability"),

  datasets: () => request<any>("/lab/datasets"),
  runEval: (body: {
    dataset: string;
    provider?: string;
    system_version?: string;
    classifier_version?: string;
  }) => request<any>("/lab/evals/run", { method: "POST", body: JSON.stringify(body) }),
  evalRuns: () => request<any>("/lab/evals/runs"),
  evalRun: (id: string) => request<any>(`/lab/evals/runs/${id}`),

  reviews: (status?: string) =>
    request<any>(`/lab/reviews${status ? `?status=${status}` : ""}`),
  decideReview: (id: string, approve: boolean, note: string) =>
    request<any>(`/lab/reviews/${id}/decide`, {
      method: "POST",
      body: JSON.stringify({ approve, note }),
    }),

  playground: (body: {
    message: string;
    system_version?: string;
    classifier_version?: string;
  }) => request<AssistantResponse>("/lab/playground/run", {
    method: "POST",
    body: JSON.stringify(body),
  }),
};
