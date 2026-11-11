// Runs once when the Mongo data volume is first created.
// Creates the application database and a least-privilege app user.
// The seed script (apps/api) creates collections, indexes and demo data.

const dbName = process.env.MONGO_INITDB_DATABASE || "ai_service_desk";
const appDb = db.getSiblingDB(dbName);

appDb.createCollection("_bootstrap");
appDb._bootstrap.insertOne({
  note: "Initialized by docker-entrypoint. Run the backend seed to populate data.",
  createdAt: new Date(),
});

print(`[init] Database '${dbName}' ready. Run 'make seed' to populate demo data.`);
