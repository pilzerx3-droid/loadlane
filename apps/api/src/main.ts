import "reflect-metadata";
import { createAppPool } from "@loadlane/db";
import { Redis } from "ioredis";
import { createApp } from "./create-app.ts";
import { RedisThrottlerStorage } from "./platform/redis-throttler-storage.ts";
import { SmtpMailProvider } from "./platform/mail.ts";
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
const mail = config.mail
  ? new SmtpMailProvider({ url: config.mail.smtpUrl, from: config.mail.from })
  : undefined;
// A rate limit shared by all instances needs a store they all reach; without one each instance counts alone.
const limiterRedis = config.rateLimitRedisUrl
  ? new Redis(config.rateLimitRedisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false })
  : undefined;
limiterRedis?.on("error", () => undefined); // outages are reported once by the storage, not on every retry
const rateLimitStorage = limiterRedis
  ? new RedisThrottlerStorage(limiterRedis, (message) => console.warn(message))
  : undefined;
const app = await createApp({
  config,
  pool,
  rateLimit: { limit: config.rateLimitPerMinute, windowMs: 60_000 },
  openApiEnabled: config.openApiEnabled,
  log: { level: config.logLevel },
  ...(storage ? { storage } : {}),
  ...(mail ? { mail } : {}),
  ...(rateLimitStorage ? { rateLimitStorage } : {}),
});

const shutdown = async (): Promise<void> => {
  await app.close();
  await pool.end();
  limiterRedis?.disconnect();
  await telemetry.shutdown();
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await app.listen(config.port, config.host);
