// Integration test: needs the local PostgreSQL from infra/docker-compose.yml (pnpm infra:up).
// Creates a throwaway database, applies all migrations to it and drops it again.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseUrlFromEnv } from "./env.ts";
import { runMigrations } from "./migrate.ts";

const adminUrl = databaseUrlFromEnv();
const testDbName = `loadlane_test_${randomUUID().replaceAll("-", "")}`;
const testDbUrl = (() => {
  const url = new URL(adminUrl);
  url.pathname = `/${testDbName}`;
  return url.toString();
})();

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe("migrations", () => {
  beforeAll(async () => {
    await withClient(adminUrl, (c) => c.query(`CREATE DATABASE "${testDbName}"`));
  });

  afterAll(async () => {
    await withClient(adminUrl, (c) =>
      c.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`),
    );
  });

  it("apply to an empty database and enable PostGIS", async () => {
    await runMigrations(testDbUrl);

    const postgis = await withClient(testDbUrl, (c) =>
      c.query<{ extversion: string }>(
        "SELECT extversion FROM pg_extension WHERE extname = 'postgis'",
      ),
    );
    expect(postgis.rows).toHaveLength(1);
  });

  it("are idempotent when run again", async () => {
    await runMigrations(testDbUrl);

    const applied = await withClient(testDbUrl, (c) =>
      c.query<{ count: string }>("SELECT count(*) AS count FROM drizzle.__drizzle_migrations"),
    );
    expect(Number(applied.rows[0]?.count)).toBe(1);
  });
});
