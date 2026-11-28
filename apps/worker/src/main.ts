// Starts the worker process: pnpm worker:start (needs APP_DATABASE_URL, see .env.example).
import { appDatabaseUrlFromEnv, createAppPool, parseEncryptionKey } from "@loadlane/db";
import { startRetentionLoop, type Log } from "./retention-job.ts";
import { startWebhookLoop } from "./webhook-job.ts";

const log: Log = (message, fields) => {
  console.log(
    JSON.stringify({
      level: 30,
      time: new Date().toISOString(),
      context: "worker",
      msg: message,
      ...fields,
    }),
  );
};

const pool = createAppPool(appDatabaseUrlFromEnv());
const loop = startRetentionLoop(pool, log);
const webhookKey = parseEncryptionKey(process.env["WEBHOOK_ENCRYPTION_KEY"]);
const webhookLoop = webhookKey
  ? startWebhookLoop(pool, log, {
      key: webhookKey,
      allowPrivate: process.env["WEBHOOK_ALLOW_PRIVATE_HOSTS"] === "true",
    })
  : undefined;
if (!webhookKey) log("webhook delivery is off: WEBHOOK_ENCRYPTION_KEY is not set");
log("worker started");

async function shutdown(): Promise<void> {
  loop.stop();
  webhookLoop?.stop();
  await pool.end();
  log("worker stopped");
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
