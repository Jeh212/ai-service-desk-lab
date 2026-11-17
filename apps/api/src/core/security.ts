import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Settings } from "./config.js";
import { AppError } from "./errors.js";
export const Role = z.enum(["customer", "agent", "admin"]);
export type Auth = {
  org_id: string;
  user_id: string;
  roles: z.infer<typeof Role>[];
  correlation_id: string;
};
export const id = (prefix: string) =>
  `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
export const isStaff = (auth: Auth) =>
  auth.roles.includes("agent") || auth.roles.includes("admin");
export function requireStaff(auth: Auth) {
  if (!isStaff(auth))
    throw new AppError(
      "forbidden",
      "Only support staff can access the review queue.",
    );
}
const claimsSchema = z
  .object({
    org_id: z.string().min(1),
    user_id: z.string().min(1),
    roles: z.array(Role),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict();
const sign = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");
export function issueToken(
  auth: Pick<Auth, "org_id" | "user_id" | "roles">,
  settings: Settings,
  now = Date.now(),
) {
  const seconds = Math.floor(now / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      ...auth,
      iat: seconds,
      exp: seconds + settings.demo_session_ttl_minutes * 60,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload, settings.demo_auth_secret)}`;
}
export function verifyToken(
  token: string,
  settings: Settings,
  now = Date.now(),
): Auth {
  const parts = token.split(".");
  const [payload, signature] = parts;
  if (parts.length !== 2 || !payload || !signature)
    throw new AppError("unauthenticated", "Malformed session token.");
  const expected = Buffer.from(sign(payload, settings.demo_auth_secret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new AppError("unauthenticated", "Invalid session signature.");
  let claims: z.infer<typeof claimsSchema>;
  try {
    claims = claimsSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString()),
    );
  } catch {
    throw new AppError("unauthenticated", "Invalid session claims.");
  }
  if (claims.exp <= Math.floor(now / 1000))
    throw new AppError("unauthenticated", "Session has expired.");
  return {
    org_id: claims.org_id,
    user_id: claims.user_id,
    roles: claims.roles,
    correlation_id: id("req"),
  };
}
