import { createApp } from "./app.js";
import { getSettings } from "./core/config.js";
const settings = getSettings();
try {
  const app = await createApp({ settings, logger: true });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  await app.listen({ host: settings.api_host, port: settings.api_port });
} catch {
  console.error(
    "API startup failed. Check MongoDB connectivity and provider configuration.",
  );
  process.exitCode = 1;
}
