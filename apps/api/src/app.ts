import Fastify, {
  type FastifyRequest,
  type FastifyError,
  type RouteHandlerMethod,
} from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { z } from "zod";
import { getSettings, type Settings } from "./core/config.js";
import { AppError } from "./core/errors.js";
import { issueToken, verifyToken, type Auth } from "./core/security.js";
import { Database, MongoConnection } from "./repositories/store.js";
import { Repositories } from "./repositories/repos.js";
import { Services } from "./domain/services.js";
import {
  AssistantResponse,
  CancellationProposal,
  IntentClassification,
  ToolCall,
  ToolResult,
  ChatMessageInput,
  ConfirmActionInput,
  ReviewDecisionInput,
  jsonSchema,
} from "./contracts/index.js";
import { buildProvider, type LLMProvider } from "./ai/providers.js";
import { buildRegistry } from "./ai/tools.js";
import { Orchestrator } from "./ai/orchestrator.js";
import { definitions, ALLOWED_TOOLS } from "./ai/intents.js";
import { systemPrompts, classifierPrompts } from "./ai/prompts.js";
import {
  listDatasets,
  loadDataset,
  runEvaluation,
  saveReport,
} from "./ai/evaluation.js";
import { redact } from "./ai/trace.js";
declare module "fastify" {
  interface FastifyRequest {
    auth: Auth | null;
  }
}
const versions = {
  system_version: z.enum(["system-v1", "system-v2"]).nullable().optional(),
  classifier_version: z
    .enum(["classify-v1", "classify-v2"])
    .nullable()
    .optional(),
};
const RunEvalInput = z
  .object({
    dataset: z.string().min(1),
    provider: z.enum(["mock", "groq"]).nullable().optional(),
    ...versions,
  })
  .strict();
const PlaygroundInput = z
  .object({ message: z.string().trim().min(1).max(4000), ...versions })
  .strict();
const LoginInput = z.object({ login_code: z.string().trim().min(1) }).strict();
const pathParam = (req: FastifyRequest, key: string) =>
  z.record(z.string()).parse(req.params)[key]!;
const limitQuery = (req: FastifyRequest, fallback: number, max = 500) =>
  z
    .object({
      limit: z.coerce.number().int().min(1).max(max).default(fallback),
    })
    .parse(req.query).limit;
const principal = (req: FastifyRequest) => {
  if (!req.auth) throw new AppError("unauthenticated", "Missing bearer token.");
  return req.auth;
};
export async function createApp(
  options: {
    database?: Database;
    settings?: Settings;
    provider?: LLMProvider;
    logger?: boolean;
  } = {},
) {
  const settings = options.settings ?? getSettings();
  const app = Fastify({
    logger: options.logger
      ? {
          level: settings.log_level.toLowerCase(),
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            'res.headers["set-cookie"]',
          ],
        }
      : false,
    bodyLimit: 64 * 1024,
    ajv: {
      customOptions: {
        coerceTypes: false,
        useDefaults: false,
        removeAdditional: false,
      },
    },
  });
  let mongo: MongoConnection | undefined;
  try {
    const database =
      options.database ??
      (await (mongo = new MongoConnection(settings)).connect());
    const repos = new Repositories(database),
      services = new Services(repos),
      provider = options.provider ?? buildProvider(settings),
      registry = buildRegistry();
    const orchestrator = (system?: string | null, classifier?: string | null) =>
      new Orchestrator(
        provider,
        registry,
        services,
        settings,
        system ?? undefined,
        classifier ?? undefined,
      );
    app.addHook("onClose", async () => {
      await mongo?.close();
    });
    await app.register(cors, {
      origin: settings.cors_origins
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      credentials: true,
    });
    await app.register(swagger, {
      openapi: {
        info: {
          title: "AI Service Desk Lab API",
          version: "0.2.0",
          description: "TypeScript backend for reliable, safe LLM features.",
        },
        components: {
          securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
        },
      },
    });
    await app.register(swaggerUi, { routePrefix: "/docs" });
    app.decorateRequest("auth", null);
    app.addHook("onRequest", async (req) => {
      const path = req.url.split("?")[0];
      if (
        req.method === "OPTIONS" ||
        path === "/health" ||
        path === "/auth/login" ||
        path === "/openapi.json" ||
        path === "/docs" ||
        path?.startsWith("/docs/")
      )
        return;
      const header = req.headers.authorization;
      if (!header || !header.toLowerCase().startsWith("bearer "))
        throw new AppError("unauthenticated", "Missing bearer token.");
      req.auth = verifyToken(header.slice(7).trim(), settings);
    });
    app.setErrorHandler<FastifyError>((error, _req, reply) => {
      if (error instanceof AppError)
        return reply.code(error.status).send(error.toJSON());
      if (
        error instanceof z.ZodError ||
        error.validation ||
        error.code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
        error.code === "FST_ERR_CTP_EMPTY_JSON_BODY"
      )
        return reply.code(422).send({
          error: {
            code: "invalid_input",
            message: "Request validation failed.",
          },
        });
      if (error.statusCode === 413)
        return reply.code(413).send({
          error: {
            code: "invalid_input",
            message: "Request body is too large.",
          },
        });
      app.log.error(
        { error: redact({ name: error.name, code: error.code }) },
        "Request failed",
      );
      return reply.code(500).send({
        error: {
          code: "internal_error",
          message: "An unexpected error occurred.",
        },
      });
    });
    const get = (url: string, handler: RouteHandlerMethod) =>
      app.get(url, { schema: { security: [{ bearerAuth: [] }] } }, handler);
    const post = <S extends z.ZodTypeAny>(
      url: string,
      schema: S,
      handler: (req: FastifyRequest, body: z.infer<S>) => Promise<unknown>,
      response?: z.ZodTypeAny,
    ) =>
      app.post(
        url,
        {
          schema: {
            body: jsonSchema(schema),
            security: url === "/auth/login" ? [] : [{ bearerAuth: [] }],
            ...(response ? { response: { 200: jsonSchema(response) } } : {}),
          },
        },
        async (req) => handler(req, schema.parse(req.body)),
      );
    app.get("/health", async () => {
      const ok = mongo ? await mongo.ping() : true;
      return {
        status: ok ? "ok" : "degraded",
        provider: provider.name,
        model: provider.model,
        mongo: ok,
      };
    });
    app.get("/openapi.json", { schema: { hide: true } }, async () =>
      app.swagger(),
    );
    post("/auth/login", LoginInput, async (_req, body) => {
      const user = await repos.users.findOne({
        demo_login_code: body.login_code,
      });
      if (!user)
        throw new AppError(
          "unauthenticated",
          "Unknown login code. Try a seeded demo code.",
        );
      const roles = z
        .array(z.enum(["customer", "agent", "admin"]))
        .parse(user.roles);
      const { user_id, org_id, name, email } = user;
      return {
        token: issueToken({ user_id, org_id, roles }, settings),
        user: { user_id, org_id, name, email, roles },
      };
    });
    get("/auth/me", async (req) => {
      const auth = principal(req),
        user = await repos.users.findOne({
          org_id: auth.org_id,
          user_id: auth.user_id,
        });
      if (!user)
        throw new AppError("unauthenticated", "User no longer exists.");
      const { user_id, org_id, name, email, roles } = user;
      return {
        user_id,
        org_id,
        name,
        email,
        roles,
        correlation_id: auth.correlation_id,
      };
    });
    post(
      "/chat/messages",
      ChatMessageInput,
      async (req, body) => orchestrator().handleMessage(principal(req), body),
      AssistantResponse,
    );
    post(
      "/chat/confirm",
      ConfirmActionInput,
      async (req, body) =>
        orchestrator().confirm(
          principal(req),
          body.conversation_id,
          body.proposal_id,
          body.confirm,
        ),
      AssistantResponse,
    );
    get("/chat/conversations", async (req) => {
      const { org_id, user_id } = principal(req);
      return (
        await repos.conversations.find(
          { org_id, user_id },
          { sort: [["updated_at", -1]] },
        )
      ).map((c) => ({
        conversation_id: c.conversation_id,
        updated_at: c.updated_at,
        message_count: c.messages.length,
        preview: c.messages.at(-1)?.content.slice(0, 120) ?? "",
      }));
    });
    get("/chat/conversations/:conversation_id", async (req) => {
      const { org_id, user_id } = principal(req),
        conv = await repos.conversations.findOne({
          org_id,
          user_id,
          conversation_id: pathParam(req, "conversation_id"),
        });
      if (!conv)
        throw new AppError("cross_tenant_access", "Conversation not found.");
      return conv;
    });
    get("/me/subscription", async (req) => {
      const auth = principal(req),
        subscription = await services.subscription(auth);
      return {
        subscription,
        plan: await repos.plans.findOne({
          org_id: auth.org_id,
          code: subscription.plan_code,
        }),
      };
    });
    get("/me/billing", async (req) => ({
      charges: await services.billing(principal(req), limitQuery(req, 20, 50)),
    }));
    get("/lab/intents", async () => ({
      version: "2024-11-a",
      intents: Object.entries(definitions).map(([intent, description]) => ({
        intent,
        description,
        allowed_tools: [
          ...ALLOWED_TOOLS[intent as keyof typeof ALLOWED_TOOLS],
        ].sort(),
      })),
    }));
    get("/lab/contracts", async () => ({
      contracts: Object.entries({
        IntentClassification,
        ToolCall,
        ToolResult,
        CancellationProposal,
        AssistantResponse,
      }).map(([name, schema]) => ({
        name,
        schema: jsonSchema(schema),
        examples:
          name === "IntentClassification"
            ? {
                valid: {
                  intent: "cancel_subscription",
                  needs_clarification: false,
                  rationale: "Explicit request to cancel.",
                  confidence: 0.92,
                  contract_version: "2024-11-a",
                },
                invalid: {
                  intent: "delete_everything",
                  needs_clarification: "yes",
                },
                invalid_reason:
                  "intent is not a valid enum value; needs_clarification is not a bool",
              }
            : null,
      })),
    }));
    get("/lab/tools", async () => ({
      tools: registry
        .all()
        .map(
          ({
            name,
            description,
            model_facing,
            allowed_roles,
            possible_errors,
            parameters,
          }) => ({
            name,
            description,
            model_facing,
            allowed_roles,
            possible_errors,
            parameters,
            handler: name,
          }),
        ),
    }));
    get("/lab/prompts", async () => ({
      system: systemPrompts,
      default_system: "system-v2",
      classifier_versions: Object.keys(classifierPrompts),
      default_classifier: "classify-v2",
    }));
    get("/lab/knowledge", async (req) => ({
      documents: await repos.knowledge.find({ org_id: principal(req).org_id }),
    }));
    get("/lab/traces", async (req) => ({
      traces: (
        await database
          .get("traces")
          .find(
            { org_id: principal(req).org_id },
            { sort: [["created_at", -1]], limit: limitQuery(req, 50) },
          )
      ).map((t) => ({
        correlation_id: t.correlation_id,
        conversation_id: t.conversation_id,
        created_at: t.created_at,
        provider: t.provider,
        model: t.model,
        llm_calls: t.llm_calls,
        tool_calls: t.tool_calls,
        steps: Array.isArray(t.steps) ? t.steps.length : 0,
      })),
    }));
    get("/lab/traces/:correlation_id", async (req) => {
      const trace = await database.get("traces").findOne({
        org_id: principal(req).org_id,
        correlation_id: pathParam(req, "correlation_id"),
      });
      if (!trace) throw new AppError("proposal_not_found", "Trace not found.");
      return trace;
    });
    get("/lab/observability", async (req) => {
      const traces = await database
          .get("traces")
          .find(
            { org_id: principal(req).org_id },
            { sort: [["created_at", -1]], limit: limitQuery(req, 200) },
          ),
        tools: Record<string, number> = {};
      let errors = 0;
      for (const t of traces)
        for (const s of z
          .array(z.object({ step: z.string(), status: z.string() }))
          .parse(t.steps)) {
          if (s.step.startsWith("tool:")) {
            const name = s.step.slice(5);
            tools[name] = (tools[name] ?? 0) + 1;
          }
          if (s.status === "error") errors++;
        }
      const sum = (field: string) =>
          traces.reduce((n, t) => n + Number(t[field] ?? 0), 0),
        prompt_tokens = sum("prompt_tokens"),
        completion_tokens = sum("completion_tokens");
      return {
        conversations_traced: traces.length,
        llm_calls: sum("llm_calls"),
        tool_calls: sum("tool_calls"),
        validation_or_tool_errors: errors,
        prompt_tokens,
        completion_tokens,
        estimated_cost_usd:
          Math.round(
            ((prompt_tokens + completion_tokens) / 1_000_000) * 0.1 * 1e6,
          ) / 1e6,
        top_tools: Object.entries(tools).sort((a, b) => b[1] - a[1]),
      };
    });
    post(
      "/lab/playground/run",
      PlaygroundInput,
      async (req, body) =>
        orchestrator(
          body.system_version,
          body.classifier_version,
        ).handleMessage(principal(req), { message: body.message }),
      AssistantResponse,
    );
    get("/lab/datasets", async () => listDatasets());
    post("/lab/evals/run", RunEvalInput, async (req, body) => {
      const report = await runEvaluation(
        await loadDataset(body.dataset),
        settings,
        body,
      );
      await database
        .get("eval_runs")
        .insertOne({ ...report, org_id: principal(req).org_id });
      await saveReport(report);
      return report;
    });
    get("/lab/evals/runs", async (req) => ({
      runs: (
        await database
          .get("eval_runs")
          .find(
            { org_id: principal(req).org_id },
            { sort: [["created_at", -1]], limit: limitQuery(req, 50) },
          )
      ).map((r) => ({
        run_id: r.run_id,
        dataset_name: r.dataset_name,
        dataset_version: r.dataset_version,
        provider: r.provider,
        model: r.model,
        prompt_version: r.prompt_version,
        created_at: r.created_at,
        metrics: r.metrics,
      })),
    }));
    get("/lab/evals/runs/:run_id", async (req) => {
      const report = await database.get("eval_runs").findOne({
        org_id: principal(req).org_id,
        run_id: pathParam(req, "run_id"),
      });
      if (!report) throw new AppError("proposal_not_found", "Run not found.");
      const { org_id: _, ...publicReport } = report;
      return publicReport;
    });
    get("/lab/reviews", async (req) => {
      const { status } = z
        .object({ status: z.string().optional() })
        .parse(req.query);
      return {
        reviews: await services.listReviews(
          principal(req),
          status === "pending",
        ),
      };
    });
    post(
      "/lab/reviews/:review_id/decide",
      ReviewDecisionInput,
      async (req, body) =>
        services.decideReview(
          principal(req),
          pathParam(req, "review_id"),
          body.approve,
          body.note,
        ),
    );
    await app.ready();
    return app;
  } catch (error) {
    await app.close();
    await mongo?.close();
    throw error;
  }
}
