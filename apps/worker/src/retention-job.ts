import { purgeExpiredPositions, type RetentionReport } from "@loadlane/db";
import type pg from "pg";

/** The retention rule is checked once a day. */
export const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type Log = (message: string, fields?: Record<string, unknown>) => void;

/**
 * Runs the retention rule once. It logs counts only: never coordinates, transport ids or names.
 * A failure is logged and returned as undefined so the loop keeps running.
 */
export async function runRetentionOnce(
  pool: pg.Pool,
  log: Log,
  purge: (pool: pg.Pool) => Promise<RetentionReport> = purgeExpiredPositions,
): Promise<RetentionReport | undefined> {
  try {
    const report = await purge(pool);
    log("retention finished", { ...report });
    return report;
  } catch (error) {
    log("retention failed", { error: error instanceof Error ? error.name : "unknown" });
    return undefined;
  }
}

/** Runs the rule now and then every day until `stop()` is called. */
export function startRetentionLoop(
  pool: pg.Pool,
  log: Log,
  intervalMs: number = RETENTION_INTERVAL_MS,
): { stop: () => void } {
  void runRetentionOnce(pool, log);
  const timer = setInterval(() => void runRetentionOnce(pool, log), intervalMs);
  return { stop: () => clearInterval(timer) };
}
