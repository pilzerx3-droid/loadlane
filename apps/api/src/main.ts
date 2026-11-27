import "reflect-metadata";
import { createAppPool } from "@loadlane/db";
import { createApp } from "./create-app.ts";
import { S3ObjectStorage } from "./platform/object-storage.ts";
import { startTelemetry } from "./platform/telemetry.ts";
import { loadApiConfig, loadEnvFileIfPresent } from "./config/env.ts";

loadEnvFileIfPresent();
const config = loadApiConfig(process.env);

const telemetry = startTelemetry({ exporter: config.tracesExporter, serviceName: "loadlane-api" });
const pool = createAppPool(config.databaseUrl);
const storage = config.s3 ? new S3ObjectStorage(config.s3) : undefined;
if (storage) {
  storage.ensureBucket().catch((error: unknown) => {
    console.error(
      "File storage is not ready:",
      error instanceof Error ? error.message : String(error),
    );
  });
}
const app = await createApp({
  config,
  pool,
  rateLimit: { limit: config.rateLimitPerMinute, windowMs: 60_000 },
  openApiEnabled: config.openApiEnabled,
  log: { level: config.logLevel },
  ...(storage ? { storage } : {}),
});

const shutdown = async (): Promise<void> => {
  await app.close();
  await pool.end();
  await telemetry.shutdown();
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await app.listen(config.port, config.host);
