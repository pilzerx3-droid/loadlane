import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT_ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));

/** Returns DATABASE_URL, loading the repo-root .env first when it exists. */
export function databaseUrlFromEnv(): string {
  if (!process.env["DATABASE_URL"] && existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.");
  }
  return url;
}
