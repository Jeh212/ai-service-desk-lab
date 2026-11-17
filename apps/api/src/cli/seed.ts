import { getSettings } from "../core/config.js";
import { MongoConnection } from "../repositories/store.js";
import { Repositories } from "../repositories/repos.js";
import { seedAll } from "../seeds.js";
const mongo = new MongoConnection(getSettings());
try {
  console.log(await seedAll(new Repositories(await mongo.connect())));
} catch {
  console.error("Seeding failed. Check MongoDB connectivity.");
  process.exitCode = 1;
} finally {
  await mongo.close();
}
