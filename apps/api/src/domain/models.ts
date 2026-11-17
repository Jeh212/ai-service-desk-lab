import { z } from "zod";

// Stored documents keep the existing snake_case fields and ISO date strings.
export const Organization = z.object({
  org_id: z.string(),
  name: z.string(),
  created_at: z.string(),
});
export type Organization = z.infer<typeof Organization>;

export const User = z.object({
  user_id: z.string(),
  org_id: z.string(),
  email: z.string(),
  name: z.string(),
  roles: z.array(z.string()).default(["customer"]),
  demo_login_code: z.string(),
});
export type User = z.infer<typeof User>;

export const Plan = z.object({
  plan_id: z.string(),
  org_id: z.string(),
  code: z.string(),
  name: z.string(),
  price_cents: z.number().int(),
  currency: z.string().default("USD"),
  billing_period: z.string().default("monthly"),
  features: z.array(z.string()).default([]),
});
export type Plan = z.infer<typeof Plan>;

export const Subscription = z.object({
  subscription_id: z.string(),
  org_id: z.string(),
  user_id: z.string(),
  plan_code: z.string(),
  status: z.enum(["active", "cancelled", "past_due"]),
  started_at: z.string(),
  current_period_end: z.string(),
  cancelled_at: z.union([z.string(), z.null()]).default(null),
  cancel_effective_at: z.union([z.string(), z.null()]).default(null),
});
export type Subscription = z.infer<typeof Subscription>;

export const Policy = z.object({
  policy_id: z.string(),
  org_id: z.string(),
  kind: z.string(),
  version: z.number().int(),
  notice_days: z.number().int().default(0),
  refund_window_days: z.number().int().default(0),
  prorate_refund: z.boolean().default(false),
  cancellation_fee_cents: z.number().int().default(0),
  summary: z.string().default(""),
});
export type Policy = z.infer<typeof Policy>;

export const BillingRecord = z.object({
  charge_id: z.string(),
  org_id: z.string(),
  user_id: z.string(),
  subscription_id: z.string(),
  amount_cents: z.number().int(),
  currency: z.string().default("USD"),
  description: z.string(),
  status: z.string().default("paid"),
  created_at: z.string(),
});
export type BillingRecord = z.infer<typeof BillingRecord>;

export const KnowledgeDoc = z.object({
  doc_id: z.string(),
  org_id: z.string(),
  title: z.string(),
  category: z.string(),
  content: z.string(),
  version: z.number().int().default(1),
  published: z.boolean().default(true),
  created_at: z.string(),
  updated_at: z.string(),
});
export type KnowledgeDoc = z.infer<typeof KnowledgeDoc>;

export const Message = z.object({
  role: z.string(),
  content: z.string(),
  created_at: z.string(),
  intent: z.union([z.string(), z.null()]).default(null),
  correlation_id: z.union([z.string(), z.null()]).default(null),
});
export type Message = z.infer<typeof Message>;

export const Conversation = z.object({
  conversation_id: z.string(),
  org_id: z.string(),
  user_id: z.string(),
  messages: z
    .array(
      z.object({
        role: z.string(),
        content: z.string(),
        created_at: z.string(),
        intent: z.union([z.string(), z.null()]).default(null),
        correlation_id: z.union([z.string(), z.null()]).default(null),
      }),
    )
    .default([]),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Conversation = z.infer<typeof Conversation>;

export const AuditLog = z.object({
  audit_id: z.string(),
  org_id: z.string(),
  user_id: z.string(),
  action: z.string(),
  target_id: z.union([z.string(), z.null()]).default(null),
  actor: z.string(),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.string(),
});
export type AuditLog = z.infer<typeof AuditLog>;
