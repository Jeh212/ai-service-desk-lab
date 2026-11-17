import test from "node:test";
import assert from "node:assert/strict";
import { apiFixture } from "./helpers.js";
import type { Response } from "../src/contracts/index.js";
test("health, authentication, CORS, OpenAPI and every read-only surface", async (t) => {
  const { app, login } = await apiFixture();
  t.after(() => app.close());
  assert.equal((await app.inject("/health")).json().provider, "mock");
  assert.equal((await app.inject("/auth/me")).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/chat/messages",
        payload: { message: "hi" },
      })
    ).statusCode,
    401,
  );
  const headers = await login();
  for (const path of [
    "/auth/me",
    "/me/subscription",
    "/me/billing",
    "/chat/conversations",
    "/chat/conversations/conv_demo_alice",
    "/lab/intents",
    "/lab/contracts",
    "/lab/tools",
    "/lab/prompts",
    "/lab/knowledge",
    "/lab/traces",
    "/lab/observability",
    "/lab/datasets",
    "/lab/evals/runs",
  ]) {
    const r = await app.inject({ url: path, headers });
    assert.equal(r.statusCode, 200, `${path}: ${r.body}`);
  }
  const docs = await app.inject("/openapi.json");
  assert.equal(docs.statusCode, 200);
  assert.ok(docs.json().paths["/chat/messages"]);
  assert.ok(docs.json().paths["/lab/evals/run"]);
  assert.equal((await app.inject("/docs/")).statusCode, 200);
  const cors = await app.inject({
    method: "OPTIONS",
    url: "/chat/messages",
    headers: {
      origin: "http://localhost:3000",
      "access-control-request-method": "POST",
    },
  });
  assert.equal(
    cors.headers["access-control-allow-origin"],
    "http://localhost:3000",
  );
});
test("full HTTP cancellation keeps frontend contract and rejects duplicate confirmation", async (t) => {
  const { app, login } = await apiFixture();
  t.after(() => app.close());
  const headers = await login();
  const sent = await app.inject({
    method: "POST",
    url: "/chat/messages",
    headers,
    payload: { message: "I want to cancel my subscription now" },
  });
  assert.equal(sent.statusCode, 200, sent.body);
  const body = sent.json<Response>();
  assert.equal(body.state, "awaiting_confirmation");
  assert.ok(body.proposal);
  assert.equal(
    (await app.inject({ url: "/me/subscription", headers })).json().subscription
      .status,
    "active",
  );
  const payload = {
    conversation_id: body.conversation_id,
    proposal_id: body.proposal.proposal_id,
    confirm: true,
  };
  const confirm = await app.inject({
    method: "POST",
    url: "/chat/confirm",
    headers,
    payload,
  });
  assert.equal(confirm.statusCode, 200, confirm.body);
  assert.equal(confirm.json<Response>().state, "action_completed");
  assert.equal(
    (await app.inject({ url: "/me/subscription", headers })).json().subscription
      .status,
    "cancelled",
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/chat/confirm",
        headers,
        payload,
      })
    ).statusCode,
    409,
  );
  const history = await app.inject({
    url: `/chat/conversations/${body.conversation_id}`,
    headers,
  });
  assert.equal(history.json().messages.length, 4);
});
test("information questions do not prepare, and traces remain inspectable", async (t) => {
  const { app, login, db } = await apiFixture();
  t.after(() => app.close());
  const headers = await login();
  const r = await app.inject({
    method: "POST",
    url: "/chat/messages",
    headers,
    payload: { message: "How does cancellation work?" },
  });
  assert.equal(r.json<Response>().state, "answered");
  assert.equal(r.json<Response>().proposal, null);
  assert.equal(await db.get("proposals").count({}), 0);
  const trace = await app.inject({
    url: `/lab/traces/${r.json<Response>().correlation_id}`,
    headers,
  });
  assert.ok(
    trace
      .json()
      .steps.some(
        (s: { step: string }) => s.step === "tool:get_cancellation_policy",
      ),
  );
  assert.ok(
    (await app.inject({ url: "/lab/observability", headers })).json()
      .prompt_tokens > 0,
  );
});
test("refunds create reviews; only tenant staff can decide them", async (t) => {
  const { app, login } = await apiFixture();
  t.after(() => app.close());
  const headers = await login();
  assert.equal(
    (await app.inject({ url: "/lab/reviews", headers })).statusCode,
    403,
  );
  const response = await app.inject({
    method: "POST",
    url: "/chat/messages",
    headers,
    payload: { message: "I want a refund" },
  });
  assert.equal(response.json<Response>().state, "human_review");
  const staff = await login("dave-acme");
  const reviews = await app.inject({
    url: "/lab/reviews?status=pending",
    headers: staff,
  });
  assert.ok(reviews.json().reviews.length >= 2);
  const decision = await app.inject({
    method: "POST",
    url: `/lab/reviews/${response.json<Response>().review_id}/decide`,
    headers: staff,
    payload: { approve: true, note: "Reviewed" },
  });
  assert.equal(decision.json().status, "approved");
});
test("tenants cannot view conversations or traces and cannot abandon foreign proposals", async (t) => {
  const { app, login, db } = await apiFixture();
  t.after(() => app.close());
  const alice = await login(),
    bob = await login("bob-acme"),
    carol = await login("carol-globex");
  const response = (
    await app.inject({
      method: "POST",
      url: "/chat/messages",
      headers: alice,
      payload: { message: "Cancel my plan" },
    })
  ).json<Response>();
  for (const headers of [bob, carol]) {
    assert.equal(
      (
        await app.inject({
          url: `/chat/conversations/${response.conversation_id}`,
          headers,
        })
      ).statusCode,
      403,
    );
    const own = (
      await app.inject({
        method: "POST",
        url: "/chat/messages",
        headers,
        payload: { message: "hello" },
      })
    ).json<Response>();
    const r = await app.inject({
      method: "POST",
      url: "/chat/confirm",
      headers,
      payload: {
        conversation_id: own.conversation_id,
        proposal_id: response.proposal!.proposal_id,
        confirm: false,
      },
    });
    assert.ok([404, 409].includes(r.statusCode), r.body);
  }
  assert.equal(
    (
      await db
        .get("proposals")
        .findOne({ proposal_id: response.proposal!.proposal_id })
    )?.status,
    "pending",
  );
  assert.equal(
    (
      await app.inject({
        url: `/lab/traces/${response.correlation_id}`,
        headers: carol,
      })
    ).statusCode,
    404,
  );
  const sub = (
    await app.inject({ url: "/me/subscription", headers: carol })
  ).json();
  assert.equal(sub.subscription.org_id, "org_globex");
});
test("HTTP validation rejects coercion, extra claims, blank input, invalid versions and traversal", async (t) => {
  const { app, login } = await apiFixture();
  t.after(() => app.close());
  const headers = await login();
  for (const payload of [
    { message: " " },
    { message: "hi", org_id: "evil" },
    { message: 5 },
  ])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/chat/messages",
          headers,
          payload,
        })
      ).statusCode,
      422,
    );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/chat/confirm",
        headers,
        payload: { conversation_id: "c", proposal_id: "p", confirm: "true" },
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (await app.inject({ url: "/me/billing?limit=-1", headers })).statusCode,
    422,
  );
  for (const dataset of [
    "../README.md",
    "../datasets/service_desk_v1.json",
    "missing.json",
  ])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/lab/evals/run",
          headers,
          payload: { dataset },
        })
      ).statusCode,
      422,
    );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/lab/playground/run",
        headers,
        payload: { message: "hello", system_version: "typo" },
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { login_code: "invalid" },
      })
    ).statusCode,
    401,
  );
});
test("playground and evaluation endpoints produce reports scoped to the initiating tenant", async (t) => {
  const { app, login, db } = await apiFixture();
  t.after(() => app.close());
  const headers = await login();
  const playground = await app.inject({
    method: "POST",
    url: "/lab/playground/run",
    headers,
    payload: {
      message: "What plan am I on?",
      system_version: "system-v1",
      classifier_version: "classify-v1",
    },
  });
  assert.equal(playground.statusCode, 200, playground.body);
  const result = await app.inject({
    method: "POST",
    url: "/lab/evals/run",
    headers,
    payload: { dataset: "service_desk_v1.json", provider: "mock" },
  });
  assert.equal(result.statusCode, 200, result.body);
  const report = result.json();
  assert.equal(report.metrics.passed, 27);
  assert.equal(report.metrics.failed, 0);
  assert.equal(
    (await app.inject({ url: `/lab/evals/runs/${report.run_id}`, headers }))
      .statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ url: "/lab/evals/runs", headers })).json().runs.length,
    1,
  );
  const carol = await login("carol-globex");
  assert.equal(
    (
      await app.inject({
        url: `/lab/evals/runs/${report.run_id}`,
        headers: carol,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: "/lab/evals/runs", headers: carol })).json().runs
      .length,
    0,
  );
  assert.equal(await db.get("proposals").count({}), 0);
});
