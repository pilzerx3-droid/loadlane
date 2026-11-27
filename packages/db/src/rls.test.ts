// Tenant isolation tests (ADR 0002, backlog P1-05). Needs the local PostgreSQL (pnpm infra:up).
// Two organizations, A and B, are created through the application role. Every test then checks what
// organization A can and cannot see or change, including deliberately wrong queries.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, expectPgError, type TestDatabase } from "./testing/test-database.ts";
import { withTenant, type TenantContext } from "./tenant.ts";

const orgA = randomUUID();
const orgB = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
const userBoth = randomUUID();
const membershipA = randomUUID();
const membershipB = randomUUID();

/** Tables whose rows carry an organization_id. */
const TENANT_TABLES = ["membership", "membership_role", "audit_log"] as const;

/** Tables in schema public that deliberately have no row-level security. */
const TABLES_WITHOUT_RLS = new Set([
  "role", // fixed catalog, no customer data, read-only for the application
  "spatial_ref_sys", // PostGIS reference table
]);

let testDb: TestDatabase;

function run<T>(context: TenantContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withTenant(testDb.appPool, context, ({ client }) => fn(client));
}

async function count(context: TenantContext, sql: string, params: unknown[] = []): Promise<number> {
  const result = await run(context, (c) =>
    c.query<{ n: number }>(`SELECT count(*)::int AS n ${sql}`, params),
  );
  return result.rows[0]?.n ?? -1;
}

async function seedOrganization(
  organizationId: string,
  adminUserId: string,
  adminMembershipId: string,
  name: string,
): Promise<void> {
  await run({ organizationId, userId: adminUserId }, async (c) => {
    await c.query(
      "INSERT INTO organization (id, name, slug, timezone) VALUES ($1, $2, $3, 'America/Chicago')",
      [organizationId, name, `org-${organizationId}`],
    );
    await c.query("INSERT INTO app_user (id, email, display_name) VALUES ($1, $2, $3)", [
      adminUserId,
      `${adminUserId}@example.com`,
      `Admin of ${name}`,
    ]);
    await c.query(
      "INSERT INTO membership (id, organization_id, user_id, status) VALUES ($1, $2, $3, 'active')",
      [adminMembershipId, organizationId, adminUserId],
    );
    await c.query(
      "INSERT INTO membership_role (organization_id, membership_id, role_key) VALUES ($1, $2, 'admin')",
      [organizationId, adminMembershipId],
    );
    await c.query(
      "INSERT INTO audit_log (organization_id, actor_type, actor_user_id, action) VALUES ($1, 'user', $2, 'organization.created')",
      [organizationId, adminUserId],
    );
  });
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedOrganization(orgA, userA, membershipA, "Organization A");
  await seedOrganization(orgB, userB, membershipB, "Organization B");

  // One person who belongs to both organizations.
  await run({ userId: userBoth }, (c) =>
    c.query("INSERT INTO app_user (id, email, display_name) VALUES ($1, $2, 'Both')", [
      userBoth,
      `${userBoth}@example.com`,
    ]),
  );
  for (const organizationId of [orgA, orgB]) {
    await run({ organizationId, userId: userBoth }, (c) =>
      c.query(
        "INSERT INTO membership (organization_id, user_id, status) VALUES ($1, $2, 'active')",
        [organizationId, userBoth],
      ),
    );
  }
});

afterAll(async () => {
  await testDb.drop();
});

describe("tenant isolation", () => {
  it.each(TENANT_TABLES)("%s: each organization sees only its own rows", async (table) => {
    for (const [organizationId, other] of [
      [orgA, orgB],
      [orgB, orgA],
    ] as const) {
      const rows = await run({ organizationId }, (c) =>
        c.query<{ organization_id: string }>(`SELECT DISTINCT organization_id FROM ${table}`),
      );
      expect(rows.rows.map((row) => row.organization_id)).toEqual([organizationId]);
      // The deliberately wrong query: ask for the other organization explicitly.
      expect(
        await count({ organizationId }, `FROM ${table} WHERE organization_id = $1`, [other]),
      ).toBe(0);
    }
  });

  it("organization: each tenant sees only itself, even when asking for the other id", async () => {
    expect(await count({ organizationId: orgA }, "FROM organization")).toBe(1);
    expect(await count({ organizationId: orgA }, "FROM organization WHERE id = $1", [orgB])).toBe(
      0,
    );
    expect(await count({ organizationId: orgB }, "FROM organization WHERE id = $1", [orgA])).toBe(
      0,
    );
  });

  it("app_user: a tenant sees its own members and nobody else", async () => {
    const names = await run({ organizationId: orgA }, (c) =>
      c.query<{ id: string }>("SELECT id FROM app_user ORDER BY id"),
    );
    expect(names.rows.map((row) => row.id).sort()).toEqual([userA, userBoth].sort());
    expect(await count({ organizationId: orgA }, "FROM app_user WHERE id = $1", [userB])).toBe(0);
  });

  it("rejects inserts that claim another organization", async () => {
    const stranger = randomUUID();
    const attempts: [string, string, unknown[]][] = [
      [
        "membership",
        "INSERT INTO membership (organization_id, user_id) VALUES ($1, $2)",
        [orgB, userA],
      ],
      [
        "membership_role",
        "INSERT INTO membership_role (organization_id, membership_id, role_key) VALUES ($1, $2, 'sales')",
        [orgB, membershipB],
      ],
      [
        "audit_log",
        "INSERT INTO audit_log (organization_id, actor_type, action) VALUES ($1, 'system', 'forged')",
        [orgB],
      ],
      [
        "organization",
        "INSERT INTO organization (id, name, slug, timezone) VALUES ($1, 'Intruder', 'intruder', 'UTC')",
        [stranger],
      ],
    ];
    for (const [table, sql, params] of attempts) {
      await expectPgError(
        run({ organizationId: orgA, userId: userA }, (c) => c.query(sql, params)),
        "42501",
      );
      expect(table).toBeTruthy();
    }
  });

  it("cannot move a row to another organization by updating organization_id", async () => {
    await expectPgError(
      run({ organizationId: orgA }, (c) =>
        c.query("UPDATE membership SET organization_id = $1 WHERE id = $2", [orgB, membershipA]),
      ),
      "42501",
    );
  });

  it("updates and deletes aimed at another organization touch zero rows", async () => {
    await run({ organizationId: orgA }, async (c) => {
      const updates = await Promise.all([
        c.query("UPDATE organization SET name = 'hacked' WHERE id = $1", [orgB]),
        c.query("UPDATE membership SET status = 'removed' WHERE organization_id = $1", [orgB]),
        c.query("DELETE FROM membership_role WHERE organization_id = $1", [orgB]),
      ]);
      expect(updates.map((result) => result.rowCount)).toEqual([0, 0, 0]);
    });

    // Organization B is untouched.
    const row = await run({ organizationId: orgB }, (c) =>
      c.query<{ name: string }>("SELECT name FROM organization WHERE id = $1", [orgB]),
    );
    expect(row.rows[0]?.name).toBe("Organization B");
    expect(await count({ organizationId: orgB }, "FROM membership_role")).toBe(1);
    expect(await count({ organizationId: orgB }, "FROM membership WHERE status = 'removed'")).toBe(
      0,
    );
  });

  it("returns nothing and rejects writes when no tenant is set", async () => {
    for (const table of [
      "organization",
      "app_user",
      "membership",
      "membership_role",
      "audit_log",
    ]) {
      expect(await count({}, `FROM ${table}`), table).toBe(0);
    }
    await expectPgError(
      run({}, (c) =>
        c.query(
          "INSERT INTO audit_log (organization_id, actor_type, action) VALUES ($1, 'system', 'x')",
          [orgA],
        ),
      ),
      "42501",
    );
  });

  it("also restricts a non-superuser table owner (FORCE ROW LEVEL SECURITY)", async () => {
    // The local owner role is a PostgreSQL superuser, and superusers bypass RLS no matter what.
    // That is why the application must never connect as the owner. To show what FORCE guarantees
    // for a production owner without that privilege, the test hands the table to a throwaway
    // non-superuser role inside a transaction that is rolled back.
    const client = await testDb.ownerPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE ROLE rls_probe_owner NOLOGIN NOSUPERUSER NOBYPASSRLS");
      await client.query("ALTER TABLE organization OWNER TO rls_probe_owner");
      await client.query("SET LOCAL ROLE rls_probe_owner");
      const result = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM organization",
      );
      expect(result.rows[0]?.n).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    // The rollback restored the original owner, and rows still exist for the tenants.
    expect(await count({ organizationId: orgA }, "FROM organization")).toBe(1);
  });
});

describe("organization switcher", () => {
  it("shows a person their own organizations and memberships without a tenant", async () => {
    expect(await count({ userId: userBoth }, "FROM organization")).toBe(2);
    expect(await count({ userId: userBoth }, "FROM membership")).toBe(2);
    expect(await count({ userId: userA }, "FROM organization")).toBe(1);
    expect(await count({ userId: randomUUID() }, "FROM organization")).toBe(0);
  });

  it("does not widen what a chosen tenant can see in tenant-scoped tables", async () => {
    const context = { organizationId: orgA, userId: userBoth };
    expect(await count(context, "FROM audit_log")).toBe(1);
    expect(await count(context, "FROM membership_role")).toBe(1);
    expect(await count(context, "FROM audit_log WHERE organization_id = $1", [orgB])).toBe(0);
  });
});

describe("app_user self-service", () => {
  it("lets a person change only their own row", async () => {
    const context = { organizationId: orgA, userId: userA };
    await run(context, async (c) => {
      const own = await c.query("UPDATE app_user SET display_name = 'Renamed' WHERE id = $1", [
        userA,
      ]);
      const other = await c.query("UPDATE app_user SET display_name = 'Renamed' WHERE id = $1", [
        userBoth,
      ]);
      expect([own.rowCount, other.rowCount]).toEqual([1, 0]);
    });
  });

  it("lets a person register only themselves", async () => {
    const stranger = randomUUID();
    await expectPgError(
      run({ userId: userA }, (c) =>
        c.query(
          "INSERT INTO app_user (id, email, display_name) VALUES ($1, 'x@example.com', 'x')",
          [stranger],
        ),
      ),
      "42501",
    );
  });
});

describe("tenant context handling", () => {
  it("does not leak the tenant to the next user of the same connection", async () => {
    const singleConnection = new pg.Pool({ connectionString: testDb.appUrl, max: 1 });
    try {
      await withTenant(singleConnection, { organizationId: orgA, userId: userA }, ({ client }) =>
        client.query("SELECT 1"),
      );
      const after = await singleConnection.query<{ org: string | null; n: number }>(
        "SELECT nullif(current_setting('app.organization_id', true), '') AS org, (SELECT count(*)::int FROM organization) AS n",
      );
      expect(after.rows[0]).toEqual({ org: null, n: 0 });
    } finally {
      await singleConnection.end();
    }
  });

  it("rolls back everything when the callback throws", async () => {
    const id = randomUUID();
    await expect(
      run({ organizationId: id }, async (c) => {
        await c.query(
          "INSERT INTO organization (id, name, slug, timezone) VALUES ($1, 'Temp', $2, 'UTC')",
          [id, `org-${id}`],
        );
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await count({ organizationId: id }, "FROM organization")).toBe(0);
  });

  it("rejects values that are not UUIDs before touching the database", async () => {
    await expect(
      run({ organizationId: "x'; DROP TABLE organization; --" }, () => Promise.resolve(1)),
    ).rejects.toThrow(TypeError);
    await expect(run({ userId: "not-a-uuid" }, () => Promise.resolve(1))).rejects.toThrow(
      TypeError,
    );
  });
});

describe("guards for future tables", () => {
  it("every table in schema public enables and forces RLS, unless explicitly allowed", async () => {
    const tables = await testDb.ownerPool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`,
    );
    const names = tables.rows.map((row) => row.relname);
    expect(names).toEqual(expect.arrayContaining(["organization", "membership", "audit_log"]));

    const unprotected = tables.rows
      .filter((row) => !TABLES_WITHOUT_RLS.has(row.relname))
      .filter((row) => !(row.relrowsecurity && row.relforcerowsecurity))
      .map((row) => row.relname);
    expect(unprotected, "tables missing ENABLE/FORCE ROW LEVEL SECURITY").toEqual([]);
  });

  it("every protected table has policies, and all policies apply to loadlane_app only", async () => {
    const policies = await testDb.ownerPool.query<{ tablename: string; roles: string[] }>(
      "SELECT tablename, roles::text[] AS roles FROM pg_policies WHERE schemaname = 'public'",
    );
    const tablesWithPolicies = new Set(policies.rows.map((row) => row.tablename));
    for (const table of [
      "organization",
      "app_user",
      "membership",
      "membership_role",
      "audit_log",
    ]) {
      expect(tablesWithPolicies.has(table), table).toBe(true);
    }
    for (const policy of policies.rows)
      expect(policy.roles, policy.tablename).toEqual(["loadlane_app"]);
  });

  it("the application role is neither superuser nor allowed to bypass RLS, and owns nothing", async () => {
    const role = await testDb.ownerPool.query<Record<string, boolean>>(
      "SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'loadlane_app'",
    );
    expect(role.rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
    });
    const owned = await testDb.ownerPool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'loadlane_app'",
    );
    expect(owned.rows[0]?.n).toBe(0);
  });
});
