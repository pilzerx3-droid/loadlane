// Command line entry point of `pnpm db:migrate`. Uses the owner connection (DATABASE_URL).
// Keep it separate from migrate.ts: other packages import that file, and importing it must never
// start a migration.
import { databaseUrlFromEnv } from "./env.ts";
import { runMigrations } from "./migrate.ts";

try {
  await runMigrations(databaseUrlFromEnv());
  console.log("Migrations applied.");
} catch (error) {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
