import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { issueToken, verifyToken } from "../src/core/security.js";
import { redact } from "../src/ai/trace.js";
import { auth, settings, now } from "./helpers.js";
const claims = () => ({
  org_id: "org_acme",
  user_id: "user_alice",
  roles: ["customer" as const],
});
test("session roundtrip and Python HMAC format compatibility", () => {
  const token = issueToken(claims(), settings, now.getTime());
  assert.equal(
    verifyToken(token, settings, now.getTime()).user_id,
    auth().user_id,
  );
  const payload = Buffer.from(
    '{"org_id":"org_acme","user_id":"user_alice","roles":["customer"],"iat":1794916800,"exp":1794960000}',
  ).toString("base64url");
  const signature = createHmac("sha256", settings.demo_auth_secret)
    .update(payload)
    .digest("base64url");
  assert.equal(
    verifyToken(`${payload}.${signature}`, settings, now.getTime()).org_id,
    "org_acme",
  );
});
test("tampered payload, forged roles, malformed and expired tokens fail", () => {
  const token = issueToken(claims(), settings, now.getTime()),
    [payload, sig] = token.split(".");
  for (const value of ["bad", `${payload}AA.${sig}`, `${payload}.${sig}x`])
    assert.throws(() => verifyToken(value, settings, now.getTime()), {
      code: "unauthenticated",
    });
  assert.throws(
    () =>
      verifyToken(
        token,
        settings,
        now.getTime() + settings.demo_session_ttl_minutes * 60000,
      ),
    { code: "unauthenticated" },
  );
});
test("invalid signed claims cannot bypass schema validation", () => {
  const payload = Buffer.from(
    JSON.stringify({
      org_id: "org_acme",
      user_id: "user_alice",
      roles: ["root"],
      iat: 0,
      exp: 9999999999,
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", settings.demo_auth_secret)
    .update(payload)
    .digest("base64url");
  assert.throws(() => verifyToken(`${payload}.${sig}`, settings), {
    code: "unauthenticated",
  });
});
test("recursive redaction hides keys, tokens and provider credentials", () => {
  const result = redact({
    nested: [{ token: "secret", api_key: "abc" }],
    text: "gsk_123abc Bearer hello.token",
  });
  assert.deepEqual(result, {
    nested: [{ token: "***", api_key: "***" }],
    text: "*** Bearer ***",
  });
});
