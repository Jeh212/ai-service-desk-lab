import data from "./seed-data.json" with { type: "json" };
import { collections, type Doc } from "./repositories/store.js";
import type { Repositories } from "./repositories/repos.js";
export const ORG_ACME = "org_acme",
  ORG_GLOBEX = "org_globex",
  USER_ALICE = "user_alice",
  USER_BOB = "user_bob",
  USER_CAROL = "user_carol",
  SUB_ALICE = "sub_alice_pro",
  SUB_BOB = "sub_bob_basic",
  SUB_CAROL = "sub_carol_basic";
const keys: Record<string, string> = {
  organizations: "org_id",
  users: "user_id",
  plans: "plan_id",
  subscriptions: "subscription_id",
  policies: "policy_id",
  billing: "charge_id",
  knowledge: "doc_id",
  conversations: "conversation_id",
  reviews: "review_id",
};
function shift(value: unknown, offset: number): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value))
    return new Date(Date.parse(value) + offset).toISOString();
  if (Array.isArray(value)) return value.map((v) => shift(v, offset));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shift(v, offset)]),
    );
  return value;
}
export async function seedAll(repos: Repositories, now = new Date()) {
  const counts: Record<string, number> = {};
  for (const collection of collections) {
    const key = keys[collection];
    if (!key) continue;
    const docs = data[collection];
    counts[collection === "organizations" ? "orgs" : collection] = docs.length;
    for (const raw of docs) {
      const doc = shift(
        raw,
        now.getTime() - Date.parse("2026-01-01T00:00:00Z"),
      ) as Doc;
      const query = { [key]: doc[key] };
      const store = repos.db.get(collection);
      if (
        (collection === "conversations" || collection === "reviews") &&
        (await store.findOne(query))
      )
        continue;
      await store.updateOne(query, { $set: doc }, true);
    }
  }
  return counts;
}
