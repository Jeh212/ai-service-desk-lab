import { z } from "zod";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const DATASETS_DIR = resolve(ROOT, "datasets");
export const REPORTS_DIR = resolve(ROOT, "reports");
config({
  path: [resolve(ROOT, ".env"), resolve(ROOT, "apps/api/.env")],
  quiet: true,
});
const positiveInt = z.coerce.number().int().positive();
const schema = z.object({
  app_env: z.enum(["development", "test", "production"]).default("development"),
  log_level: z.string().default("INFO"),
  log_json: z
    .preprocess(
      (v) =>
        typeof v === "string" ? ["true", "1"].includes(v.toLowerCase()) : v,
      z.boolean(),
    )
    .default(false),
  api_host: z.string().default("0.0.0.0"),
  api_port: positiveInt.max(65535).default(8000),
  cors_origins: z.string().default("http://localhost:3000"),
  mongo_uri: z
    .string()
    .default("mongodb://root:example@localhost:27017/?authSource=admin"),
  mongo_db: z.string().default("ai_service_desk"),
  llm_provider: z.enum(["mock", "groq"]).default("mock"),
  groq_api_key: z.string().optional(),
  groq_model: z.string().default("llama-3.1-8b-instant"),
  groq_structured_model: z.string().default("openai/gpt-oss-20b"),
  llm_temperature: z.coerce.number().min(0).max(2).default(0.1),
  llm_max_tokens: positiveInt.default(1024),
  llm_timeout_seconds: z.coerce.number().positive().default(30),
  llm_max_tool_iterations: positiveInt.max(20).default(5),
  llm_history_window: z.coerce.number().int().nonnegative().default(10),
  llm_max_retries: z.coerce.number().int().min(0).max(10).default(2),
  eval_concurrency: positiveInt.max(20).default(2),
  demo_auth_secret: z.string().default("change-me-dev-only-secret"),
  demo_session_ttl_minutes: positiveInt.default(720),
});
export type Settings = z.infer<typeof schema>;
export function getSettings(overrides: Partial<Settings> = {}): Settings {
  return schema.parse({
    ...Object.fromEntries(
      Object.entries(process.env).map(([k, v]) => [k.toLowerCase(), v]),
    ),
    ...overrides,
  });
}
