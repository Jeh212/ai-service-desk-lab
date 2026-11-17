import { getSettings } from "../core/config.js";
import { MongoConnection, collections } from "../repositories/store.js";
import { Repositories } from "../repositories/repos.js";
import { seedAll } from "../seeds.js";
const mongo = new MongoConnection(getSettings());
try {
  const db = await mongo.connect();
  for (const name of collections) await db.get(name).deleteMany({});
  console.log(await seedAll(new Repositories(db)));
} catch {
  console.error("Reset failed. Check MongoDB connectivity.");
  process.exitCode = 1;
} finally {
  await mongo.close();
}
