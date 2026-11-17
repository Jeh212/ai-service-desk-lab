import test from "node:test";
import assert from "node:assert/strict";
import { fixture, auth, now } from "./helpers.js";
import { roundEven } from "../src/domain/services.js";
import { seedAll } from "../src/seeds.js";
test("prepare computes Acme terms, execute cancels and writes one audit", async () => {
  const { services, repos } = await fixture();
  const p = await services.prepare(auth(), null, now);
  assert.equal(p.status, "pending");
  assert.equal(p.terms.refund_amount_cents, 3267);
  assert.equal(p.terms.effective_date, now.toISOString());
  assert.equal((await services.subscription(auth())).status, "active");
  const result = await services.execute(auth(), p.proposal_id, now);
  assert.equal(result.status, "cancelled");
  assert.equal(
    await repos.audit.store.count({ action: "subscription.cancelled" }),
    1,
  );
  await assert.rejects(() => services.execute(auth(), p.proposal_id, now), {
    code: "duplicate_operation",
  });
});
test("Globex retains period end with fee and no refund", async () => {
  const { services } = await fixture();
  const p = await services.prepare(auth("carol"), null, now);
  assert.equal(p.terms.refund_amount_cents, 0);
  assert.equal(p.terms.penalty_cents, 500);
  assert.equal(p.terms.effective_date, "2026-12-07T12:00:00.000Z");
});
test("expired proposals, nonactive subscriptions and wrong users are rejected", async () => {
  const { services } = await fixture();
  const p = await services.prepare(auth(), null, now);
  await assert.rejects(
    () => services.execute(auth("bob"), p.proposal_id, now),
    { code: "proposal_mismatch" },
  );
  await assert.rejects(
    () =>
      services.execute(auth(), p.proposal_id, new Date(now.getTime() + 900000)),
    { code: "proposal_expired" },
  );
  await assert.rejects(() => services.prepare(auth("bob"), null, now), {
    code: "operation_not_allowed",
  });
});
test("declining is user-bound and cannot abandon an executed proposal", async () => {
  const { services } = await fixture();
  const p = await services.prepare(auth(), null, now);
  await assert.rejects(
    () => services.abandon(auth("bob"), p.proposal_id, now),
    { code: "proposal_mismatch" },
  );
  await assert.rejects(
    () => services.abandon(auth("carol"), p.proposal_id, now),
    { code: "proposal_not_found" },
  );
  await services.execute(auth(), p.proposal_id, now);
  await assert.rejects(() => services.abandon(auth(), p.proposal_id, now), {
    code: "duplicate_operation",
  });
});
test("concurrent confirmations execute only once", async () => {
  const { services, repos } = await fixture();
  const p = await services.prepare(auth(), null, now);
  const results = await Promise.allSettled([
    services.execute(auth(), p.proposal_id, now),
    services.execute(auth(), p.proposal_id, now),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    await repos.audit.store.count({ action: "subscription.cancelled" }),
    1,
  );
});
test("multiple proposals for one subscription cannot double cancel", async () => {
  const { services, repos } = await fixture();
  const a = await services.prepare(auth(), null, now),
    b = await services.prepare(auth(), null, now);
  const results = await Promise.allSettled([
    services.execute(auth(), a.proposal_id, now),
    services.execute(auth(), b.proposal_id, now),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    await repos.audit.store.count({ action: "subscription.cancelled" }),
    1,
  );
});
test("tenant and owner isolation for subscriptions, proposals and knowledge", async () => {
  const { services } = await fixture();
  await assert.rejects(() => services.subscription(auth(), "sub_carol_basic"), {
    code: "subscription_not_found",
  });
  await assert.rejects(
    () => services.subscription(auth("bob"), "sub_alice_pro"),
    { code: "cross_tenant_access" },
  );
  const p = await services.prepare(auth(), null, now);
  await assert.rejects(() => services.proposal(auth("carol"), p.proposal_id), {
    code: "proposal_not_found",
  });
  for (const user of ["alice", "carol"]) {
    const docs = await services.searchKnowledge(auth(user), "cancellation");
    assert.ok(docs.length);
    assert.ok(docs.every((d) => d.org_id === auth(user).org_id));
  }
});
test("knowledge search escapes regex syntax and excludes unpublished documents", async () => {
  const { services, repos } = await fixture();
  await repos.knowledge.update(
    { doc_id: "kb_acme_cancel" },
    { published: false },
  );
  assert.equal(
    (await services.searchKnowledge(auth(), "cancellation")).length,
    0,
  );
  assert.equal((await services.searchKnowledge(auth(), ".*")).length, 0);
});
test("staff review decisions are tenant-scoped and single-use", async () => {
  const { services, repos } = await fixture();
  const r = await services.createReview(
    auth(),
    "refund_request",
    "Refund please",
    null,
    now,
  );
  await assert.rejects(() => services.decideReview(auth(), r.review_id, true), {
    code: "forbidden",
  });
  const foreign = { ...auth("carol"), roles: ["agent" as const] };
  await assert.rejects(
    () => services.decideReview(foreign, r.review_id, true),
    { code: "proposal_not_found" },
  );
  const results = await Promise.allSettled([
    services.decideReview(auth("dave"), r.review_id, true),
    services.decideReview(auth("dave"), r.review_id, false),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await repos.audit.store.count({ target_id: r.review_id }), 1);
});
test("seed is idempotent and preserves existing conversation history", async () => {
  const { db, repos } = await fixture();
  await repos.append("org_acme", "conv_demo_alice", [
    {
      role: "user",
      content: "hello",
      created_at: now.toISOString(),
      intent: null,
      correlation_id: null,
    },
  ]);
  await seedAll(repos, now);
  assert.equal(await db.get("users").count({}), 4);
  assert.equal(
    (await repos.conversations.findOne({ conversation_id: "conv_demo_alice" }))
      ?.messages.length,
    3,
  );
});
test("currency rounding matches Python tie-to-even", () => {
  assert.equal(roundEven(2.5), 2);
  assert.equal(roundEven(3.5), 4);
  assert.equal(roundEven(3.6), 4);
});
