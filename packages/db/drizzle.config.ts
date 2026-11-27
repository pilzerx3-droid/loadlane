import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` and `check` work offline against the schema and migration snapshots.
// Applying migrations is done by src/migrate.ts, not by drizzle-kit.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
});
