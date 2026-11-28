// Background job worker. Public surface for tests; the process itself starts in main.ts.
export { runRetentionOnce, startRetentionLoop, RETENTION_INTERVAL_MS } from "./retention-job.ts";
