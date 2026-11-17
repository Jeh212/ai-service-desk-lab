import { z } from "zod";
import {
  jsonSchema,
  ToolResult,
  reviewReasons,
  type Call,
  type Result,
} from "../contracts/index.js";
import { AppError, type ErrorCode } from "../core/errors.js";
import type { Auth } from "../core/security.js";
import type { Services } from "../domain/services.js";
import type { ToolSpec } from "./providers.js";
import { Trace } from "./trace.js";
export const subscriptionArgs = z
  .object({ subscription_id: z.string().nullable().default(null) })
  .strict();
export const emptyArgs = z.object({}).strict();
export const billingArgs = z
  .object({ limit: z.number().int().min(1).max(50).default(10) })
  .strict();
export const reviewArgs = z
  .object({ reason: z.string(), summary: z.string().max(1000) })
  .strict();
export const searchArgs = z
  .object({
    query: z.string().min(2).max(300),
    category: z.string().nullable().default(null),
  })
  .strict();
export interface ToolContext {
  auth: Auth;
  services: Services;
  conversation_id: string | null;
  now: Date;
}
export interface ToolDefinition extends ToolSpec {
  schema: z.ZodTypeAny;
  allowed_roles: Auth["roles"];
  possible_errors: ErrorCode[];
  model_facing: boolean;
  handler: (
    ctx: ToolContext,
    args: unknown,
  ) => Promise<Record<string, unknown>>;
}
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  register<S extends z.ZodTypeAny>(
    name: string,
    description: string,
    schema: S,
    handler: (
      ctx: ToolContext,
      args: z.infer<S>,
    ) => Promise<Record<string, unknown>>,
    possible_errors: ErrorCode[] = [],
    allowed_roles: Auth["roles"] = ["customer", "agent", "admin"],
  ) {
    this.tools.set(name, {
      name,
      description,
      schema,
      parameters: jsonSchema(schema),
      handler: (ctx, args) => handler(ctx, schema.parse(args)),
      model_facing: true,
      possible_errors,
      allowed_roles,
    });
  }
  get(name: string) {
    const t = this.tools.get(name);
    if (!t) throw new AppError("tool_not_found", `Unknown tool '${name}'.`);
    return t;
  }
  all() {
    return [...this.tools.values()];
  }
  specs(allowed?: Set<string>): ToolSpec[] {
    return this.all()
      .filter((t) => t.model_facing && (!allowed || allowed.has(t.name)))
      .map(({ name, description, parameters }) => ({
        name,
        description,
        parameters,
      }));
  }
}
export function buildRegistry() {
  const r = new ToolRegistry();
  r.register(
    "get_subscription",
    "Fetch details of the authenticated customer's subscription.",
    subscriptionArgs,
    async ({ auth, services }, args) => {
      const sub = await services.subscription(auth, args.subscription_id),
        plan = await services.repos.plans.findOne({
          org_id: auth.org_id,
          code: sub.plan_code,
        });
      return {
        subscription_id: sub.subscription_id,
        plan_code: sub.plan_code,
        plan_name: plan?.name ?? sub.plan_code,
        price_cents: plan?.price_cents ?? null,
        currency: plan?.currency ?? "USD",
        status: sub.status,
        started_at: sub.started_at,
        current_period_end: sub.current_period_end,
        cancel_effective_at: sub.cancel_effective_at,
      };
    },
    ["subscription_not_found", "cross_tenant_access"],
  );
  r.register(
    "get_cancellation_policy",
    "Fetch the organization's current cancellation policy and terms.",
    emptyArgs,
    async ({ auth, services }) => {
      const p = await services.repos.latestPolicy(auth.org_id, "cancellation");
      if (!p)
        throw new AppError(
          "policy_not_found",
          "No cancellation policy configured.",
        );
      const {
        policy_id,
        version,
        notice_days,
        refund_window_days,
        prorate_refund,
        cancellation_fee_cents,
        summary,
      } = p;
      return {
        policy_id,
        version,
        notice_days,
        refund_window_days,
        prorate_refund,
        cancellation_fee_cents,
        summary,
      };
    },
    ["policy_not_found"],
  );
  r.register(
    "get_billing_history",
    "List the authenticated customer's recent charges.",
    billingArgs,
    async ({ auth, services }, args) => ({
      charges: (await services.billing(auth, args.limit)).map(
        ({
          charge_id,
          amount_cents,
          currency,
          description,
          status,
          created_at,
        }) => ({
          charge_id,
          amount_cents,
          currency,
          description,
          status,
          created_at,
        }),
      ),
    }),
  );
  r.register(
    "prepare_cancellation",
    "Prepare (NOT execute) a cancellation: computes deterministic terms and returns a proposal the customer must explicitly confirm.",
    subscriptionArgs,
    async ({ auth, services, now }, args) => {
      const p = await services.prepare(auth, args.subscription_id, now);
      const {
        effective_date,
        refund_amount_cents,
        penalty_cents,
        currency,
        summary,
        policy_version,
      } = p.terms;
      return {
        proposal_id: p.proposal_id,
        subscription_id: p.subscription_id,
        expires_at: p.expires_at,
        terms: {
          effective_date,
          refund_amount_cents,
          penalty_cents,
          currency,
          summary,
          policy_version,
        },
      };
    },
    ["subscription_not_found", "operation_not_allowed", "policy_not_found"],
  );
  r.register(
    "request_human_review",
    "Route the case to a human specialist (refunds, exceptions, uncertainty).",
    reviewArgs,
    async ({ auth, services, conversation_id, now }, args) => {
      const reason =
        reviewReasons.find((r) => r === args.reason) ?? "approval_required";
      const review = await services.createReview(
        auth,
        reason,
        args.summary,
        conversation_id,
        now,
      );
      return { review_id: review.review_id, status: review.status, reason };
    },
  );
  r.register(
    "search_knowledge_base",
    "Search the organization's knowledge base for relevant articles.",
    searchArgs,
    async ({ auth, services }, args) => ({
      results: (
        await services.searchKnowledge(auth, args.query, args.category)
      ).map((d) => ({
        doc_id: d.doc_id,
        title: d.title,
        category: d.category,
        content: d.content.slice(0, 800),
        version: d.version,
      })),
    }),
  );
  return r;
}
export class ToolDispatcher {
  constructor(private registry: ToolRegistry) {}
  async dispatch(
    call: Call,
    ctx: ToolContext,
    trace: Trace,
    allowed?: Set<string>,
  ): Promise<Result> {
    const start = performance.now();
    trace.tool_calls++;
    const fail = (
      code: ErrorCode,
      message: string,
      step = `tool:${call.name}`,
    ) => {
      const duration_ms = performance.now() - start;
      trace.add(step, "error", duration_ms, {
        error_code: code,
        arguments: call.arguments,
      });
      return ToolResult.parse({
        tool_call_id: call.id,
        name: call.name,
        ok: false,
        error_code: code,
        error_message: message,
        duration_ms,
      });
    };
    let definition: ToolDefinition;
    try {
      definition = this.registry.get(call.name);
    } catch {
      return fail("tool_not_found", `Unknown tool '${call.name}'.`);
    }
    if (allowed && !allowed.has(call.name))
      return fail(
        "tool_not_available_in_state",
        `The '${call.name}' tool is not available for this request.`,
      );
    const parsed = definition.schema.safeParse(call.arguments);
    if (!parsed.success)
      return fail(
        "tool_args_invalid",
        "Invalid tool arguments.",
        `tool_args:${call.name}`,
      );
    if (
      !definition.allowed_roles.some(
        (r) => ctx.auth.roles.includes(r) || ctx.auth.roles.includes("admin"),
      )
    )
      return fail(
        "tool_not_authorized",
        `You are not allowed to use the '${call.name}' tool.`,
      );
    try {
      const data = await definition.handler(ctx, parsed.data);
      const duration_ms = performance.now() - start;
      trace.add(`tool:${call.name}`, "ok", duration_ms, {
        arguments: call.arguments,
        result_keys: Object.keys(data),
      });
      return ToolResult.parse({
        tool_call_id: call.id,
        name: call.name,
        ok: true,
        data,
        duration_ms,
      });
    } catch (error) {
      return error instanceof AppError
        ? fail(error.code, error.message)
        : fail("tool_execution_failed", `Tool '${call.name}' failed.`);
    }
  }
}
