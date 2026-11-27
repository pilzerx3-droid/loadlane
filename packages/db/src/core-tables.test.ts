// Integration test for the core tables (migration 0001). Needs the local PostgreSQL (pnpm infra:up).
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  expectPgError,
  inTransaction,
  type TestDatabase,
} from "./testing/test-database.ts";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.drop();
});

interface Context {
  organizationId?: string;
  userId?: string;
}

/** One transaction per call. Rolls back when the callback throws. */
function run<T>(_context: Context, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(testDb.ownerPool, fn);
}

async function createOrganization(client: pg.PoolClient, id: string, slug = `org-${id}`) {
  await client.query(
    "INSERT INTO organization (id, name, slug, timezone) VALUES ($1, 'Test Org', $2, 'America/Chicago')",
    [id, slug],
  );
}

async function createUser(client: pg.PoolClient, id: string, email = `${id}@example.com`) {
  await client.query(
    "INSERT INTO app_user (id, email, display_name) VALUES ($1, $2, 'Test User')",
    [id, email],
  );
}

async function createMembership(
  client: pg.PoolClient,
  id: string,
  organizationId: string,
  userId: string,
) {
  await client.query(
    "INSERT INTO membership (id, organization_id, user_id, status) VALUES ($1, $2, $3, 'active')",
    [id, organizationId, userId],
  );
}

describe("organization", () => {
  it("applies the US defaults from ADR 0005", async () => {
    const id = randomUUID();
    const row = await run({ organizationId: id }, async (c) => {
      await createOrganization(c, id);
      const result = await c.query<Record<string, unknown>>(
        "SELECT region, distance_unit, weight_unit, currency, locale, deleted_at FROM organization WHERE id = $1",
        [id],
      );
      return result.rows[0];
    });
    expect(row).toEqual({
      region: "us",
      distance_unit: "mi",
      weight_unit: "lb",
      currency: "USD",
      locale: "en-US",
      deleted_at: null,
    });
  });

  it("requires an explicit timezone", async () => {
    const id = randomUUID();
    await expectPgError(
      run({ organizationId: id }, (c) =>
        c.query("INSERT INTO organization (id, name, slug) VALUES ($1, 'No Zone', $2)", [
          id,
          `org-${id}`,
        ]),
      ),
      "23502",
    );
  });

  it("rejects slugs that are not lowercase and url-safe", async () => {
    const id = randomUUID();
    await expectPgError(
      run({ organizationId: id }, (c) => createOrganization(c, id, "Bad Slug")),
      "23514",
    );
  });

  it("rejects a currency that is not an upper-case ISO code", async () => {
    const id = randomUUID();
    await expectPgError(
      run({ organizationId: id }, (c) =>
        c.query(
          "INSERT INTO organization (id, name, slug, timezone, currency) VALUES ($1, 'x', $2, 'America/Chicago', 'usd')",
          [id, `org-${id}`],
        ),
      ),
      "23514",
    );
  });

  it("rejects a duplicate slug", async () => {
    const first = randomUUID();
    const second = randomUUID();
    const slug = `dup-${first}`;
    await run({ organizationId: first }, (c) => createOrganization(c, first, slug));
    await expectPgError(
      run({ organizationId: second }, (c) => createOrganization(c, second, slug)),
      "23505",
    );
  });

  it("keeps updated_at current on every update", async () => {
    const id = randomUUID();
    await run({ organizationId: id }, (c) => createOrganization(c, id));
    const before = await run({ organizationId: id }, async (c) => {
      const r = await c.query<{ updated_at: Date }>(
        "SELECT updated_at FROM organization WHERE id = $1",
        [id],
      );
      return r.rows[0]?.updated_at;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = await run({ organizationId: id }, async (c) => {
      await c.query("UPDATE organization SET name = 'Renamed' WHERE id = $1", [id]);
      const r = await c.query<{ updated_at: Date }>(
        "SELECT updated_at FROM organization WHERE id = $1",
        [id],
      );
      return r.rows[0]?.updated_at;
    });
    expect(before).toBeInstanceOf(Date);
    expect(after && before && after.getTime() > before.getTime()).toBe(true);
  });
});

describe("app_user", () => {
  it("treats e-mail addresses as case-insensitive and unique", async () => {
    const email = `${randomUUID()}@example.com`;
    const first = randomUUID();
    const second = randomUUID();
    await run({ userId: first }, (c) => createUser(c, first, email));
    await expectPgError(
      run({ userId: second }, (c) => createUser(c, second, email.toUpperCase())),
      "23505",
    );
  });

  it("requires issuer and subject of the login identity together", async () => {
    const id = randomUUID();
    await expectPgError(
      run({ userId: id }, (c) =>
        c.query(
          "INSERT INTO app_user (id, email, display_name, auth_issuer) VALUES ($1, $2, 'x', 'https://issuer.example')",
          [id, `${id}@example.com`],
        ),
      ),
      "23514",
    );
  });

  it("rejects the same login identity on two users", async () => {
    const subject = randomUUID();
    const insert = (id: string) =>
      run({ userId: id }, (c) =>
        c.query(
          "INSERT INTO app_user (id, email, display_name, auth_issuer, auth_subject) VALUES ($1, $2, 'x', 'https://issuer.example', $3)",
          [id, `${id}@example.com`, subject],
        ),
      );
    await insert(randomUUID());
    await expectPgError(insert(randomUUID()), "23505");
  });
});

describe("role", () => {
  it("contains exactly the four roles from the backlog", async () => {
    const result = await testDb.ownerPool.query<{ key: string }>(
      "SELECT key FROM role ORDER BY key",
    );
    expect(result.rows.map((row) => row.key)).toEqual([
      "admin",
      "carrier_user",
      "dispatcher",
      "sales",
    ]);
  });
});

describe("ids", () => {
  it("default to uuidv7 on every table that has a generated id", async () => {
    const result = await testDb.ownerPool.query<{ table_name: string; column_default: string }>(
      `SELECT table_name, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'id'
         AND table_name IN ('organization', 'app_user', 'membership', 'audit_log')`,
    );
    expect(result.rows).toHaveLength(4);
    for (const row of result.rows) expect(row.column_default, row.table_name).toContain("uuidv7()");
  });

  it("are version 7 and sort in creation order", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await testDb.ownerPool.query<{ id: string }>("SELECT uuidv7()::text AS id");
      ids.push(r.rows[0]?.id ?? "");
    }
    for (const id of ids) expect(id.charAt(14)).toBe("7");
    expect([...ids].sort()).toEqual(ids);
  });
});

describe("membership", () => {
  it("allows one membership per person and organization", async () => {
    const org = randomUUID();
    const user = randomUUID();
    await run({ organizationId: org, userId: user }, async (c) => {
      await createOrganization(c, org);
      await createUser(c, user);
      await createMembership(c, randomUUID(), org, user);
    });
    await expectPgError(
      run({ organizationId: org, userId: user }, (c) =>
        createMembership(c, randomUUID(), org, user),
      ),
      "23505",
    );
  });

  it("lets a person belong to several organizations", async () => {
    const user = randomUUID();
    await run({ userId: user }, (c) => createUser(c, user));
    for (let i = 0; i < 2; i++) {
      const org = randomUUID();
      await run({ organizationId: org, userId: user }, async (c) => {
        await createOrganization(c, org);
        await createMembership(c, randomUUID(), org, user);
      });
    }
    const count = await testDb.ownerPool.query<{ count: string }>(
      "SELECT count(*) AS count FROM membership WHERE user_id = $1",
      [user],
    );
    expect(Number(count.rows[0]?.count)).toBe(2);
  });

  it("lets a member hold several roles", async () => {
    const org = randomUUID();
    const user = randomUUID();
    const membership = randomUUID();
    await run({ organizationId: org, userId: user }, async (c) => {
      await createOrganization(c, org);
      await createUser(c, user);
      await createMembership(c, membership, org, user);
      for (const key of ["dispatcher", "sales"]) {
        await c.query(
          "INSERT INTO membership_role (organization_id, membership_id, role_key) VALUES ($1, $2, $3)",
          [org, membership, key],
        );
      }
    });
    const roles = await testDb.ownerPool.query<{ role_key: string }>(
      "SELECT role_key FROM membership_role WHERE membership_id = $1 ORDER BY role_key",
      [membership],
    );
    expect(roles.rows.map((row) => row.role_key)).toEqual(["dispatcher", "sales"]);
  });

  it("rejects an unknown role key", async () => {
    const org = randomUUID();
    const user = randomUUID();
    const membership = randomUUID();
    await expectPgError(
      run({ organizationId: org, userId: user }, async (c) => {
        await createOrganization(c, org);
        await createUser(c, user);
        await createMembership(c, membership, org, user);
        await c.query(
          "INSERT INTO membership_role (organization_id, membership_id, role_key) VALUES ($1, $2, 'superuser')",
          [org, membership],
        );
      }),
      "23503",
    );
  });

  it("rejects a role assignment whose organization differs from its membership", async () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    const user = randomUUID();
    const membershipB = randomUUID();
    await run({ organizationId: orgB, userId: user }, async (c) => {
      await createOrganization(c, orgA);
      await createOrganization(c, orgB);
      await createUser(c, user);
      await createMembership(c, membershipB, orgB, user);
    });
    await expectPgError(
      run({ organizationId: orgA, userId: user }, (c) =>
        c.query(
          "INSERT INTO membership_role (organization_id, membership_id, role_key) VALUES ($1, $2, 'admin')",
          [orgA, membershipB],
        ),
      ),
      "23503",
    );
  });
});

describe("audit_log", () => {
  async function seedOrganization(): Promise<string> {
    const org = randomUUID();
    await run({ organizationId: org }, (c) => createOrganization(c, org));
    return org;
  }

  it("requires a user id when the actor is a user", async () => {
    const org = await seedOrganization();
    await expectPgError(
      run({ organizationId: org }, (c) =>
        c.query(
          "INSERT INTO audit_log (organization_id, actor_type, action) VALUES ($1, 'user', 'x.created')",
          [org],
        ),
      ),
      "23514",
    );
  });

  it("stores system events with changes, request id, ip and user agent", async () => {
    const org = await seedOrganization();
    const row = await run({ organizationId: org }, async (c) => {
      await c.query(
        `INSERT INTO audit_log (organization_id, actor_type, action, changes, request_id, ip, user_agent)
         VALUES ($1, 'system', 'organization.updated', '{"name": {"from": "A", "to": "B"}}', 'req-1', '203.0.113.7', 'test-agent')`,
        [org],
      );
      const result = await c.query<Record<string, unknown>>(
        "SELECT changes, request_id, host(ip) AS ip, user_agent FROM audit_log WHERE organization_id = $1",
        [org],
      );
      return result.rows[0];
    });
    expect(row).toEqual({
      changes: { name: { from: "A", to: "B" } },
      request_id: "req-1",
      ip: "203.0.113.7",
      user_agent: "test-agent",
    });
  });

  describe("is append-only", () => {
    async function seedEntry(): Promise<string> {
      const org = await seedOrganization();
      await run({ organizationId: org }, (c) =>
        c.query(
          "INSERT INTO audit_log (organization_id, actor_type, action) VALUES ($1, 'system', 'seed')",
          [org],
        ),
      );
      return org;
    }

    it("rejects updates", async () => {
      const org = await seedEntry();
      await expectPgError(
        run({ organizationId: org }, (c) =>
          c.query("UPDATE audit_log SET action = 'tampered' WHERE organization_id = $1", [org]),
        ),
        "23001",
      );
    });

    it("rejects deletes", async () => {
      const org = await seedEntry();
      await expectPgError(
        run({ organizationId: org }, (c) =>
          c.query("DELETE FROM audit_log WHERE organization_id = $1", [org]),
        ),
        "23001",
      );
    });

    it("rejects truncate", async () => {
      await seedEntry();
      await expectPgError(
        run({}, (c) => c.query("TRUNCATE audit_log")),
        "23001",
      );
    });
  });
});
