// Verifies that the local stack from infra/docker-compose.yml is reachable from the host.
// No third-party dependencies: uses raw TCP, HTTP and `docker compose exec`.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";

if (existsSync(".env")) process.loadEnvFile(".env");

const env = (name: string, fallback: string): string => process.env[name] ?? fallback;

const POSTGRES_PORT = Number(env("POSTGRES_PORT", "5432"));
const POSTGRES_USER = env("POSTGRES_USER", "loadlane");
const POSTGRES_DB = env("POSTGRES_DB", "loadlane");
const VALKEY_PORT = Number(env("VALKEY_PORT", "6379"));
const S3_ENDPOINT = env("S3_ENDPOINT", "http://127.0.0.1:8333");
const TIMEOUT_MS = 5000;

type CheckResult = { ok: true; detail: string } | { ok: false; detail: string };

/** Opens a TCP connection, optionally sends a payload and resolves with the first response chunk. */
function tcpExchange(port: number, payload?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.setTimeout(TIMEOUT_MS);
    socket.once("connect", () => {
      if (payload === undefined) {
        socket.end();
        resolve("");
      } else {
        socket.write(payload);
      }
    });
    socket.once("data", (chunk) => {
      socket.end();
      resolve(chunk.toString("utf8"));
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`timeout after ${TIMEOUT_MS} ms`));
    });
    socket.once("error", reject);
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkPostgres(): Promise<CheckResult> {
  try {
    await tcpExchange(POSTGRES_PORT);
  } catch (error) {
    return { ok: false, detail: `port ${POSTGRES_PORT} not reachable (${message(error)})` };
  }
  const sql = "SELECT default_version FROM pg_available_extensions WHERE name = 'postgis'";
  const args = ["compose", "-f", "infra/docker-compose.yml", "exec", "-T", "postgres"];
  args.push("psql", "-U", POSTGRES_USER, "-d", POSTGRES_DB, "-tAc", sql);
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: TIMEOUT_MS * 2 });
  const version = result.stdout?.trim();
  if (result.status !== 0 || !version) {
    return { ok: false, detail: `query failed: ${result.stderr?.trim() || "no PostGIS found"}` };
  }
  return { ok: true, detail: `port ${POSTGRES_PORT}, PostGIS ${version} available` };
}

async function checkValkey(): Promise<CheckResult> {
  try {
    const reply = await tcpExchange(VALKEY_PORT, "PING\r\n");
    return reply.startsWith("+PONG")
      ? { ok: true, detail: `port ${VALKEY_PORT}, PING -> PONG` }
      : { ok: false, detail: `unexpected reply: ${JSON.stringify(reply)}` };
  } catch (error) {
    return { ok: false, detail: `port ${VALKEY_PORT} not reachable (${message(error)})` };
  }
}

async function checkS3(): Promise<CheckResult> {
  try {
    const response = await fetch(S3_ENDPOINT, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await response.text();
    // An unauthenticated request must be answered by the S3 gateway with an S3 XML response.
    const isS3 = body.includes("<?xml") || response.headers.get("server")?.includes("SeaweedFS");
    return isS3
      ? { ok: true, detail: `${S3_ENDPOINT}, S3 gateway answered (HTTP ${response.status})` }
      : { ok: false, detail: `${S3_ENDPOINT} answered, but not like an S3 gateway` };
  } catch (error) {
    return { ok: false, detail: `${S3_ENDPOINT} not reachable (${message(error)})` };
  }
}

const checks: [string, () => Promise<CheckResult>][] = [
  ["PostgreSQL", checkPostgres],
  ["Valkey", checkValkey],
  ["SeaweedFS S3", checkS3],
];

let failed = 0;
for (const [name, check] of checks) {
  const result = await check();
  if (!result.ok) failed++;
  console.log(`${result.ok ? "OK  " : "FAIL"}  ${name.padEnd(13)} ${result.detail}`);
}

if (failed > 0) {
  console.error(
    `\n${failed} of ${checks.length} checks failed. Is the stack running? Try: pnpm infra:up`,
  );
  process.exit(1);
}
console.log("\nAll infrastructure checks passed.");
