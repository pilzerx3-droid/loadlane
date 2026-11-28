import { dispatchWebhooks, type DispatchReport } from "@loadlane/db";
import type pg from "pg";
import type { Log } from "./retention-job.ts";

/** Due webhook deliveries are tried every 15 seconds. */
export const WEBHOOK_INTERVAL_MS = 15_000;

export interface WebhookSettings {
  key: Buffer;
  allowPrivate: boolean;
}

/** Runs the dispatcher once. Logs counts only (never URLs, payloads or secrets); a failure keeps the loop alive. */
export async function runWebhooksOnce(
  pool: pg.Pool,
  log: Log,
  settings: WebhookSettings,
  dispatch: typeof dispatchWebhooks = dispatchWebhooks,
): Promise<DispatchReport | undefined> {
  try {
    const report = await dispatch(pool, settings);
    if (report.attempted > 0) log("webhooks dispatched", { ...report });
    return report;
  } catch (error) {
    log("webhook dispatch failed", { error: error instanceof Error ? error.name : "unknown" });
    return undefined;
  }
}

export function startWebhookLoop(
  pool: pg.Pool,
  log: Log,
  settings: WebhookSettings,
  intervalMs: number = WEBHOOK_INTERVAL_MS,
): { stop: () => void } {
  let running = false;
  const tick = async () => {
    if (running) return; // a slow receiver must not stack runs
    running = true;
    try {
      await runWebhooksOnce(pool, log, settings);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return { stop: () => clearInterval(timer) };
}
