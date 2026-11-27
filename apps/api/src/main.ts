import "reflect-metadata";
import { createAppPool } from "@loadlane/db";
import { createApp } from "./create-app.ts";
import { loadApiConfig, loadEnvFileIfPresent } from "./config/env.ts";

loadEnvFileIfPresent();
const config = loadApiConfig(process.env);

const pool = createAppPool(config.databaseUrl);
const app = await createApp({
  config,
  pool,
  rateLimit: { limit: config.rateLimitPerMinute, windowMs: 60_000 },
  openApiEnabled: config.openApiEnabled,
  log: { level: config.logLevel },
});

const shutdown = async (): Promise<void> => {
  await app.close();
  await pool.end();
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await app.listen(config.port, config.host);
