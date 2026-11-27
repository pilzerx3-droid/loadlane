// Tests for sign-in identity lookup and registration (migration 0003, ADR 0003).
// Needs the local PostgreSQL (pnpm infra:up). Everything runs as the application role.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, expectPgError, type TestDatabase } from "./testing/test-database.ts";
import { withTenant, type TenantContext } from "./tenant.ts";

const issuer = "https://issuer.example";
const subjectA = `sub-${randomUUID()}`;
const subjectB = `sub-${randomUUID()}`;
const userA = randomUUID();
const userB = randomUUID();

let testDb: TestDatabase;

function run<T>(context: TenantContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withTenant(testDb.appPool, context, ({ client }) => fn(client));
}

function register(id: string, subject: string, email: string, context: TenantContext = {}) {
  return run({ userId: id, authIssuer: issuer, authSubject: subject, ...context }, (c) =>
    c.query(
      "INSERT INTO app_user (id, email, display_name, auth_issuer, auth_subject) VALUES ($1, $2, 'Person', $3, $4)",
      [id, email, issuer, subject],
    ),
  );
}

async function visibleIds(context: TenantContext): Promise<string[]> {
  const result = await run(context, (c) => c.query<{ id: string }>("SELECT id FROM app_user"));
  return result.rows.map((row) => row.id);
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await register(userA, subjectA, `${userA}@example.com`);
  await register(userB, subjectB, `${userB}@example.com`);
});

afterAll(async () => {
  await testDb.drop();
});

describe("identity lookup", () => {
  it("finds exactly the person whose verified identity is set, without user or organization", async () => {
    expect(await visibleIds({ authIssuer: issuer, authSubject: subjectA })).toEqual([userA]);
    expect(await visibleIds({ authIssuer: issuer, authSubject: subjectB })).toEqual([userB]);
  });

  it("finds nobody for an unknown subject, a wrong issuer or a partial identity", async () => {
    expect(await visibleIds({ authIssuer: issuer, authSubject: "unknown" })).toEqual([]);
    expect(
      await visibleIds({ authIssuer: "https://other.example", authSubject: subjectA }),
    ).toEqual([]);
    expect(await visibleIds({ authIssuer: issuer })).toEqual([]);
    expect(await visibleIds({ authSubject: subjectA })).toEqual([]);
    expect(await visibleIds({})).toEqual([]);
  });
});

describe("registration", () => {
  it("lets a verified identity register itself and read the new row back", async () => {
    const id = randomUUID();
    const subject = `sub-${randomUUID()}`;
    await register(id, subject, `${id}@example.com`);
    expect(await visibleIds({ authIssuer: issuer, authSubject: subject })).toEqual([id]);
  });

  it("rejects a row that claims a different identity than the verified one", async () => {
    const id = randomUUID();
    await expectPgError(
      run({ userId: id, authIssuer: issuer, authSubject: "the-verified-subject" }, (c) =>
        c.query(
          "INSERT INTO app_user (id, email, display_name, auth_issuer, auth_subject) VALUES ($1, $2, 'x', $3, 'someone-elses-subject')",
          [id, `${id}@example.com`, issuer],
        ),
      ),
      "42501",
    );
  });

  it("rejects an identity row when the context carries no identity", async () => {
    const id = randomUUID();
    await expectPgError(
      run({ userId: id }, (c) =>
        c.query(
          "INSERT INTO app_user (id, email, display_name, auth_issuer, auth_subject) VALUES ($1, $2, 'x', $3, 'some-subject')",
          [id, `${id}@example.com`, issuer],
        ),
      ),
      "42501",
    );
  });

  it("rejects a second person with the same identity", async () => {
    await expectPgError(register(randomUUID(), subjectA, `${randomUUID()}@example.com`), "23505");
  });

  it("rejects a second person with the same e-mail address under a different identity", async () => {
    await expectPgError(
      register(randomUUID(), `sub-${randomUUID()}`, `${userA}@EXAMPLE.com`),
      "23505",
    );
  });
});

describe("what the application may change on app_user", () => {
  const own = { userId: userA, authIssuer: issuer, authSubject: subjectA };

  it("may change the display name", async () => {
    await run(own, async (c) => {
      const result = await c.query("UPDATE app_user SET display_name = 'Renamed' WHERE id = $1", [
        userA,
      ]);
      expect(result.rowCount).toBe(1);
    });
  });

  it.each([
    ["auth_subject", `auth_subject = 'taken-over'`],
    ["auth_issuer", `auth_issuer = 'https://evil.example'`],
    ["email", `email = 'other@example.com'`],
    ["deactivated_at", `deactivated_at = now()`],
  ])("may not change %s", async (_column, assignment) => {
    await expectPgError(
      run(own, (c) => c.query(`UPDATE app_user SET ${assignment} WHERE id = $1`, [userA])),
      "42501",
    );
  });
});
