import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoConnection } from "../src/repositories/store.js";
import { Repositories } from "../src/repositories/repos.js";
import { Services } from "../src/domain/services.js";
import { seedAll } from "../src/seeds.js";
import { createApp } from "../src/app.js";
import { settings, auth, now } from "./helpers.js";
test("MongoDB: indexes, existing document shapes, tenant scoping, atomic cancellation and API persistence", async (t) => {
  // Always use a disposable database; never reset the configured application DB.
  const config = {
    ...settings,
    mongo_uri: process.env.TEST_MONGO_URI ?? "mongodb://localhost:27017",
    mongo_db: `asdl_test_${randomUUID().replaceAll("-", "")}`,
  };
  const connection = new MongoConnection(config);
  t.after(async () => {
    await connection.db.dropDatabase();
    await connection.close();
  });
  const database = await connection.connect(),
    repos = new Repositories(database),
    services = new Services(repos);
  await seedAll(repos, now);
  await seedAll(repos, now);
  assert.equal(await database.get("users").count({}), 4);
  const indexes = await connection.db.collection("subscriptions").indexes();
  assert.ok(indexes.some((i) => i.unique && i.key.subscription_id));
  const proposal = await services.prepare(auth(), null, now);
  const results = await Promise.allSettled([
    services.execute(auth(), proposal.proposal_id, now),
    services.execute(auth(), proposal.proposal_id, now),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    await database.get("audit").count({ action: "subscription.cancelled" }),
    1,
  );
  await assert.rejects(() => services.subscription(auth(), "sub_carol_basic"), {
    code: "subscription_not_found",
  });
  const messages = Array.from({ length: 5 }, (_, i) => ({
    role: "user",
    content: String(i),
    created_at: now.toISOString(),
    intent: null,
    correlation_id: null,
  }));
  await Promise.all(
    messages.map((m) => repos.append("org_acme", "conv_demo_alice", [m])),
  );
  assert.equal(
    (await repos.conversations.findOne({ conversation_id: "conv_demo_alice" }))
      ?.messages.length,
    7,
  );
  const app = await createApp({ settings: config });
  t.after(() => app.close());
  const login = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { login_code: "alice-acme" },
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const sub = await app.inject({ url: "/me/subscription", headers });
  assert.equal(sub.json().subscription.status, "cancelled");
  assert.ok(!("_id" in sub.json().subscription));
  assert.equal((await app.inject("/health")).json().mongo, true);
});
