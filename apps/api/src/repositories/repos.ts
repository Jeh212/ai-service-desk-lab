import { z } from "zod";
import * as M from "../domain/models.js";
import {
  CancellationProposal,
  HumanReviewRequest,
} from "../contracts/index.js";
import {
  Database,
  type CollectionName,
  type Doc,
  type Query,
  type FindOptions,
} from "./store.js";
export class Repository<S extends z.ZodTypeAny> {
  readonly store;
  constructor(
    db: Database,
    collection: CollectionName,
    readonly schema: S,
    readonly key: string,
  ) {
    this.store = db.get(collection);
  }
  async findOne(query: Query): Promise<z.infer<S> | null> {
    const d = await this.store.findOne(query);
    return d ? (this.schema.parse(d) as z.infer<S>) : null;
  }
  async find(query: Query, options?: FindOptions): Promise<z.infer<S>[]> {
    return (await this.store.find(query, options)).map(
      (d) => this.schema.parse(d) as z.infer<S>,
    );
  }
  async insert(doc: z.infer<S>) {
    await this.store.insertOne(this.schema.parse(doc) as Doc);
  }
  async upsert(doc: z.infer<S>) {
    const value = this.schema.parse(doc) as Doc;
    await this.store.updateOne(
      {
        [this.key]: value[this.key],
        ...(value.org_id ? { org_id: value.org_id } : {}),
      },
      { $set: value },
      true,
    );
  }
  async update(query: Query, fields: Doc) {
    return this.store.updateOne(query, { $set: fields });
  }
}
export class Repositories {
  readonly orgs;
  readonly users;
  readonly plans;
  readonly subscriptions;
  readonly policies;
  readonly billing;
  readonly knowledge;
  readonly conversations;
  readonly audit;
  readonly proposals;
  readonly reviews;
  constructor(readonly db: Database) {
    this.orgs = new Repository(db, "organizations", M.Organization, "org_id");
    this.users = new Repository(db, "users", M.User, "user_id");
    this.plans = new Repository(db, "plans", M.Plan, "plan_id");
    this.subscriptions = new Repository(
      db,
      "subscriptions",
      M.Subscription,
      "subscription_id",
    );
    this.policies = new Repository(db, "policies", M.Policy, "policy_id");
    this.billing = new Repository(db, "billing", M.BillingRecord, "charge_id");
    this.knowledge = new Repository(db, "knowledge", M.KnowledgeDoc, "doc_id");
    this.conversations = new Repository(
      db,
      "conversations",
      M.Conversation,
      "conversation_id",
    );
    this.audit = new Repository(db, "audit", M.AuditLog, "audit_id");
    this.proposals = new Repository(
      db,
      "proposals",
      CancellationProposal,
      "proposal_id",
    );
    this.reviews = new Repository(
      db,
      "reviews",
      HumanReviewRequest,
      "review_id",
    );
  }
  async latestPolicy(org_id: string, kind: string) {
    return (
      (
        await this.policies.find(
          { org_id, kind },
          { sort: [["version", -1]], limit: 1 },
        )
      )[0] ?? null
    );
  }
  async append(org_id: string, conversation_id: string, messages: M.Message[]) {
    await this.conversations.store.updateOne(
      { org_id, conversation_id },
      {
        $set: { updated_at: new Date().toISOString() },
        $push: { messages: { $each: messages } },
      },
    );
  }
}
