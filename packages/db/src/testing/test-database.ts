// Helpers for integration tests that need the local PostgreSQL from infra/docker-compose.yml.
// Each test file creates its own throwaway database, so files can run in parallel.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect } from "vitest";
import { databaseUrlFromEnv } from "../env.ts";
import { runMigrations } from "../migrate.ts";

export interface TestDatabase {
  name: string;
  /** Connection string of the owner role (runs migrations). */
  ownerUrl: string;
  ownerPool: pg.Pool;
  /** Closes all pools and drops the database. */
  drop: () => Promise<void>;
}

function withDatabaseName(connectionString: string, name: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}

export async function createTestDatabase(
  options: { migrate?: boolean } = {},
): Promise<TestDatabase> {
  const adminUrl = databaseUrlFromEnv();
  const name = `loadlane_test_${randomUUID().replaceAll("-", "")}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const ownerUrl = withDatabaseName(adminUrl, name);
  if (options.migrate ?? true) await runMigrations(ownerUrl);
  const ownerPool = new pg.Pool({ connectionString: ownerUrl, max: 4 });

  return {
    name,
    ownerUrl,
    ownerPool,
    drop: async () => {
      await ownerPool.end();
      const dropper = new pg.Client({ connectionString: adminUrl });
      await dropper.connect();
      try {
        await dropper.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await dropper.end();
      }
    },
  };
}

/** Runs `fn` in one transaction: commits when it resolves, rolls back when it throws. */
export async function inTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

interface MaybePgError {
  code?: string;
  cause?: { code?: string };
}

/** Asserts that `action` fails with the given PostgreSQL SQLSTATE code. */
export async function expectPgError(action: Promise<unknown>, sqlState: string): Promise<void> {
  const error = await action.then(
    () => undefined,
    (caught: unknown) => caught ?? new Error("rejected without a reason"),
  );
  expect(error, `expected SQLSTATE ${sqlState}, but the statement succeeded`).toBeDefined();
  const pgError = error as MaybePgError;
  const description = error instanceof Error ? error.message : JSON.stringify(error);
  expect(pgError.code ?? pgError.cause?.code, description).toBe(sqlState);
}
