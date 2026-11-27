// Integration test: needs the local PostgreSQL from infra/docker-compose.yml (pnpm infra:up).
// Creates a throwaway database, applies all migrations to it and drops it again.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER, runMigrations } from "./migrate.ts";
import { createTestDatabase, type TestDatabase } from "./testing/test-database.ts";

const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
) as { entries: unknown[] };

describe("migrations", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase({ migrate: false });
  });

  afterAll(async () => {
    await testDb.drop();
  });

  it("apply to an empty database and enable PostGIS and citext", async () => {
    await runMigrations(testDb.ownerUrl);

    const extensions = await testDb.ownerPool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'citext') ORDER BY extname",
    );
    expect(extensions.rows.map((row) => row.extname)).toEqual(["citext", "postgis"]);
  });

  it("are idempotent when run again", async () => {
    await runMigrations(testDb.ownerUrl);

    const applied = await testDb.ownerPool.query<{ count: string }>(
      "SELECT count(*) AS count FROM drizzle.__drizzle_migrations",
    );
    expect(Number(applied.rows[0]?.count)).toBe(journal.entries.length);
  });
});
