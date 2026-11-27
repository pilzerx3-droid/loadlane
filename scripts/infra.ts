// Thin wrapper around `docker compose` for the local stack.
// Passes the repo-root .env to compose when it exists, so port and credential overrides apply.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const COMPOSE_FILE = "infra/docker-compose.yml";

const actions: Record<string, string[]> = {
  up: ["up", "-d", "--wait"],
  down: ["down"],
  reset: ["down", "--volumes"],
  logs: ["logs", "--tail", "100"],
};

const action = process.argv[2] ?? "";
const composeArgs = actions[action];
if (!composeArgs) {
  console.error(`Usage: node scripts/infra.ts <${Object.keys(actions).join("|")}>`);
  process.exit(2);
}

const envArgs = existsSync(".env") ? ["--env-file", ".env"] : [];
const result = spawnSync("docker", ["compose", "-f", COMPOSE_FILE, ...envArgs, ...composeArgs], {
  stdio: "inherit",
});

if (result.error) {
  console.error(`Could not run docker: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
