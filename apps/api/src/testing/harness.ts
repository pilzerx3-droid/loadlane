// Test harness for end-to-end API tests: real NestJS app, real PostgreSQL with row-level security
// (pnpm infra:up) and the local fake OIDC issuer. It proves our own checks; it does not prove how a
// real provider behaves.
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { withTenant } from "@loadlane/db";
import { createTestDatabase, type TestDatabase } from "@loadlane/db/testing";
import type { INestApplication } from "@nestjs/common";
import type { AppModuleOptions } from "../app.module.ts";
import { createApp } from "../create-app.ts";
import { startFakeIssuer, type FakeIssuer } from "./fake-issuer.ts";

export interface Person {
  id: string;
  subject: string;
  email: string;
  token: string;
}

export interface SeedMember {
  userId: string;
  status?: "invited" | "active" | "suspended" | "removed";
  roles?: string[];
}

export interface TestApi {
  app: INestApplication;
  baseUrl: string;
  issuer: FakeIssuer;
  db: TestDatabase;
  /** Signs in a new person (registering them) and returns their id and token. */
  person(label?: string): Promise<Person>;
  call(
    path: string,
    options?: {
      token?: string;
      organizationId?: string;
      headers?: Record<string, string>;
      /** HTTP method. Default GET, or POST when a JSON body is given. */
      method?: string;
      json?: unknown;
    },
  ): Promise<Response>;
  /** Creates an organization with memberships and roles through the application role. */
  seedOrganization(options: {
    creatorUserId: string;
    members: SeedMember[];
    name?: string;
  }): Promise<string>;
  /** Runs a statement as the table owner (FORCE is switched off first, so it also works for a non-superuser owner). */
  asOwner(sql: string, params?: unknown[]): Promise<void>;
  close(): Promise<void>;
}

/**
 * Starts the application against a fresh database and the fake issuer. The rate limit is high and
 * logging is off by default; tests that look at those pass their own settings.
 */
export async function startTestApi(
  overrides: Partial<Omit<AppModuleOptions, "config" | "pool">> & {
    maxOrganizationsPerUser?: number;
  } = {},
): Promise<TestApi> {
  const { maxOrganizationsPerUser, ...appOverrides } = overrides;
  const db = await createTestDatabase();
  const issuer = await startFakeIssuer("project-123");
  const app: INestApplication = await createApp({
    config: {
      oidcIssuer: issuer.issuer,
      oidcAudience: issuer.audience,
      ...(maxOrganizationsPerUser === undefined ? {} : { maxOrganizationsPerUser }),
    },
    pool: db.appPool,
    jwksCooldownMs: 0,
    rateLimit: { limit: 1_000_000, windowMs: 60_000 },
    log: { level: "silent" },
    ...appOverrides,
  });
  await app.listen(0, "127.0.0.1");
  const baseUrl = await app.getUrl();

  const call: TestApi["call"] = (path, options = {}) => {
    const headers: Record<string, string> = { ...options.headers };
    if (options.token) headers["authorization"] = `Bearer ${options.token}`;
    if (options.organizationId) headers["x-organization-id"] = options.organizationId;
    if (options.json !== undefined) headers["content-type"] = "application/json";
    return fetch(`${baseUrl}${path}`, {
      method: options.method ?? (options.json === undefined ? "GET" : "POST"),
      headers,
      ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
    });
  };

  return {
    app,
    baseUrl,
    issuer,
    db,
    call,
    async person(label = "person") {
      const subject = `${label}-${randomUUID()}`;
      const email = `${subject}@example.com`;
      issuer.setUserInfo(subject, {
        sub: subject,
        email,
        email_verified: true,
        name: `Name ${label}`,
      });
      const token = await issuer.sign({ subject });
      const response = await call("/v1/me", { token });
      if (response.status !== 200)
        throw new Error(`Could not sign in ${label}: HTTP ${response.status}`);
      const me = (await response.json()) as { user: { id: string } };
      return { id: me.user.id, subject, email, token };
    },
    async seedOrganization({ creatorUserId, members, name = "Test Organization" }) {
      const organizationId = randomUUID();
      await withTenant(
        db.appPool,
        { organizationId, userId: creatorUserId },
        async ({ client }) => {
          await client.query(
            "INSERT INTO organization (id, name, slug, timezone) VALUES ($1, $2, $3, 'America/Chicago')",
            [organizationId, name, `org-${organizationId}`],
          );
          for (const member of members) {
            const inserted = await client.query<{ id: string }>(
              "INSERT INTO membership (organization_id, user_id, status) VALUES ($1, $2, $3) RETURNING id",
              [organizationId, member.userId, member.status ?? "active"],
            );
            const membershipId = inserted.rows[0]?.id;
            for (const role of member.roles ?? []) {
              await client.query(
                "INSERT INTO membership_role (organization_id, membership_id, role_key) VALUES ($1, $2, $3)",
                [organizationId, membershipId, role],
              );
            }
          }
        },
      );
      return organizationId;
    },
    async asOwner(sql, params = []) {
      const client = await db.ownerPool.connect();
      try {
        await client.query("BEGIN");
        for (const table of ["app_user", "organization", "membership"]) {
          await client.query(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
        }
        await client.query(sql, params);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await app.close();
      await issuer.close();
      await db.drop();
    },
  };
}
