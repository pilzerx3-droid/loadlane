// Starts the worker process: pnpm worker:start (needs APP_DATABASE_URL, see .env.example).
import { appDatabaseUrlFromEnv, createAppPool } from "@loadlane/db";
import { startRetentionLoop, type Log } from "./retention-job.ts";

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
log("worker started");

async function shutdown(): Promise<void> {
  loop.stop();
  await pool.end();
  log("worker stopped");
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
