import { getSettings } from "../src/core/config.js";
import { Database } from "../src/repositories/store.js";
import { Repositories } from "../src/repositories/repos.js";
import { Services } from "../src/domain/services.js";
import { seedAll } from "../src/seeds.js";
import { id, type Auth } from "../src/core/security.js";
import { Orchestrator } from "../src/ai/orchestrator.js";
import { MockLLMProvider, type LLMProvider } from "../src/ai/providers.js";
import { buildRegistry } from "../src/ai/tools.js";
import { createApp } from "../src/app.js";
export const settings = getSettings({
  app_env: "test",
  llm_provider: "mock",
  demo_auth_secret: "test-secret",
  llm_max_retries: 1,
});
export const now = new Date("2026-11-17T12:00:00Z");
export function auth(user = "alice"): Auth {
  return {
    org_id: user === "carol" ? "org_globex" : "org_acme",
    user_id: `user_${user}`,
    roles: user === "dave" ? ["customer", "agent"] : ["customer"],
    correlation_id: id("req"),
  };
}
export async function fixture(provider: LLMProvider = new MockLLMProvider()) {
  const db = Database.memory(),
    repos = new Repositories(db);
  await seedAll(repos, now);
  const services = new Services(repos),
    registry = buildRegistry();
  return {
    db,
    repos,
    services,
    registry,
    orch: new Orchestrator(provider, registry, services, settings),
  };
}
export async function apiFixture() {
  const f = await fixture();
  const app = await createApp({ database: f.db, settings });
  const login = async (code = "alice-acme") => {
    const r = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { login_code: code },
    });
    return { authorization: `Bearer ${r.json<{ token: string }>().token}` };
  };
  return { ...f, app, login };
}
