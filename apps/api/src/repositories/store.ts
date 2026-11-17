import {
  MongoClient,
  type Db,
  type Collection,
  type Document,
  type Filter,
  type UpdateFilter,
} from "mongodb";
import type { Settings } from "../core/config.js";
export type Doc = Record<string, unknown>;
export type Query = Record<string, unknown>;
export type FindOptions = { sort?: [string, 1 | -1][]; limit?: number };
export interface DocStore {
  insertOne(doc: Doc): Promise<void>;
  findOne(query: Query): Promise<Doc | null>;
  find(query: Query, options?: FindOptions): Promise<Doc[]>;
  updateOne(query: Query, update: Doc, upsert?: boolean): Promise<number>;
  deleteMany(query: Query): Promise<number>;
  count(query: Query): Promise<number>;
}
function matches(doc: Doc, query: Query): boolean {
  return Object.entries(query).every(([key, condition]) => {
    const value = doc[key];
    if (
      condition &&
      typeof condition === "object" &&
      !Array.isArray(condition)
    ) {
      const operators = condition as Doc;
      return Object.entries(operators).every(([op, operand]) => {
        switch (op) {
          case "$in":
            return Array.isArray(operand) && operand.includes(value);
          case "$ne":
            return value !== operand;
          case "$regex":
            return (
              value != null &&
              new RegExp(
                String(operand),
                String(operators.$options ?? ""),
              ).test(String(value))
            );
          case "$options":
            return true;
          default:
            throw new Error(`Unsupported MemoryStore operator: ${op}`);
        }
      });
    }
    return value === condition;
  });
}
export class MemoryStore implements DocStore {
  private docs: Doc[] = [];
  async insertOne(doc: Doc) {
    this.docs.push(structuredClone(doc));
  }
  async findOne(query: Query) {
    return structuredClone(this.docs.find((d) => matches(d, query)) ?? null);
  }
  async find(query: Query, { sort = [], limit = 0 }: FindOptions = {}) {
    let docs = this.docs.filter((d) => matches(d, query));
    docs.sort((a, b) => {
      for (const [key, direction] of sort) {
        const av = a[key],
          bv = b[key];
        if (av === bv) continue;
        if (av == null) return direction;
        if (bv == null) return -direction;
        return (av < bv ? -1 : 1) * direction;
      }
      return 0;
    });
    if (limit > 0) docs = docs.slice(0, limit);
    return structuredClone(docs);
  }
  async updateOne(query: Query, update: Doc, upsert = false) {
    let doc = this.docs.find((d) => matches(d, query));
    if (!doc) {
      if (!upsert) return 0;
      doc = Object.fromEntries(
        Object.entries(query).filter(
          ([, v]) => typeof v !== "object" || v === null,
        ),
      );
      this.docs.push(doc);
    }
    Object.assign(doc, structuredClone(update.$set ?? {}));
    if (update.$push)
      for (const [key, value] of Object.entries(update.$push as Doc)) {
        const existing = (doc[key] ?? []) as unknown[];
        const additions =
          value && typeof value === "object" && "$each" in value
            ? (value.$each as unknown[])
            : [value];
        doc[key] = [...existing, ...structuredClone(additions)];
      }
    return 1;
  }
  async deleteMany(query: Query) {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matches(d, query));
    return before - this.docs.length;
  }
  async count(query: Query) {
    return this.docs.filter((d) => matches(d, query)).length;
  }
}
export class MongoStore implements DocStore {
  constructor(private collection: Collection<Document>) {}
  async insertOne(doc: Doc) {
    await this.collection.insertOne(structuredClone(doc));
  }
  async findOne(query: Query) {
    return this.collection.findOne(query as Filter<Document>, {
      projection: { _id: 0 },
    });
  }
  async find(query: Query, { sort = [], limit = 0 }: FindOptions = {}) {
    let cursor = this.collection.find(query, { projection: { _id: 0 } });
    if (sort.length) cursor = cursor.sort(sort);
    if (limit > 0) cursor = cursor.limit(limit);
    return cursor.toArray();
  }
  async updateOne(query: Query, update: Doc, upsert = false) {
    const result = await this.collection.updateOne(
      query,
      update as UpdateFilter<Document>,
      { upsert },
    );
    return result.matchedCount + result.upsertedCount;
  }
  async deleteMany(query: Query) {
    return (await this.collection.deleteMany(query)).deletedCount;
  }
  async count(query: Query) {
    return this.collection.countDocuments(query);
  }
}
export const collections = [
  "organizations",
  "users",
  "plans",
  "subscriptions",
  "policies",
  "billing",
  "knowledge",
  "conversations",
  "proposals",
  "reviews",
  "audit",
  "traces",
  "eval_runs",
  "eval_cases",
] as const;
export type CollectionName = (typeof collections)[number];
export class Database {
  constructor(private stores: Map<CollectionName, DocStore>) {}
  get(name: CollectionName) {
    return this.stores.get(name)!;
  }
  static memory() {
    return new Database(
      new Map(collections.map((n) => [n, new MemoryStore()])),
    );
  }
  static mongo(db: Db) {
    return new Database(
      new Map(collections.map((n) => [n, new MongoStore(db.collection(n))])),
    );
  }
}
export class MongoConnection {
  readonly client: MongoClient;
  readonly db: Db;
  constructor(settings: Settings) {
    this.client = new MongoClient(settings.mongo_uri, {
      serverSelectionTimeoutMS: 5000,
    });
    this.db = this.client.db(settings.mongo_db);
  }
  async connect() {
    await this.client.connect();
    await this.db.command({ ping: 1 });
    await this.ensureIndexes();
    return Database.mongo(this.db);
  }
  async ensureIndexes() {
    const unique: Partial<Record<CollectionName, string>> = {
      users: "user_id",
      organizations: "org_id",
      subscriptions: "subscription_id",
      conversations: "conversation_id",
      proposals: "proposal_id",
      reviews: "review_id",
      eval_runs: "run_id",
    };
    for (const [name, field] of Object.entries(unique))
      await this.db
        .collection(name)
        .createIndex({ [field]: 1 }, { unique: true });
    await this.db
      .collection("users")
      .createIndex({ demo_login_code: 1 }, { unique: true });
    const indexes: Partial<Record<CollectionName, Record<string, 1 | -1>[]>> = {
      plans: [{ org_id: 1, code: 1 }],
      subscriptions: [{ org_id: 1, user_id: 1 }],
      policies: [{ org_id: 1, kind: 1, version: -1 }],
      billing: [{ org_id: 1, user_id: 1, created_at: -1 }],
      knowledge: [
        { org_id: 1, category: 1 },
        { org_id: 1, published: 1 },
      ],
      conversations: [{ org_id: 1, user_id: 1, updated_at: -1 }],
      proposals: [{ org_id: 1, user_id: 1 }],
      reviews: [{ org_id: 1, status: 1 }],
      traces: [{ correlation_id: 1 }, { org_id: 1, created_at: -1 }],
      eval_runs: [{ created_at: -1 }, { org_id: 1, created_at: -1 }],
    };
    for (const [name, specs] of Object.entries(indexes))
      for (const keys of specs)
        await this.db.collection(name).createIndex(keys);
  }
  async ping() {
    try {
      await this.db.command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }
  async close() {
    await this.client.close();
  }
}
