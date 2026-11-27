import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT_ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));

function requireEnv(name: string, hint: string): string {
  if (!process.env[name] && existsSync(ROOT_ENV_FILE)) {
    // Never overrides variables that are already set in the environment.
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. ${hint}`);
  return value;
}

/** Owner role connection. Only for migrations and test setup, never for request handling. */
export function databaseUrlFromEnv(): string {
  return requireEnv("DATABASE_URL", "Copy .env.example to .env or export DATABASE_URL.");
}

/** Application role connection. Subject to row-level security. */
export function appDatabaseUrlFromEnv(): string {
  return requireEnv(
    "APP_DATABASE_URL",
    "Copy .env.example to .env or export APP_DATABASE_URL (role loadlane_app).",
  );
}
