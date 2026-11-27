// End-to-end test of GET /v1/me: real NestJS app, real PostgreSQL with row-level security (pnpm infra:up),
// local fake OIDC issuer. Proves our verification, registration and isolation logic. It does not prove
// that a real provider behaves like the fake one.
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { withTenant } from "@loadlane/db";
import { createTestDatabase, type TestDatabase } from "@loadlane/db/testing";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.ts";
import { startFakeIssuer, type FakeIssuer } from "../testing/fake-issuer.ts";

let testDb: TestDatabase;
let issuer: FakeIssuer;
let app: INestApplication;
let baseUrl: string;

interface Me {
  user: { id: string; email: string; displayName: string };
  organizations: { id: string; name: string; slug: string; region: string }[];
}

async function callMe(token?: string): Promise<Response> {
  return fetch(`${baseUrl}/v1/me`, token ? { headers: { authorization: `Bearer ${token}` } } : {});
}

/** Signs in as a new person whose e-mail address the provider has verified. */
async function newVerifiedPerson(label = "person") {
  const subject = `${label}-${randomUUID()}`;
  const email = `${subject}@example.com`;
  issuer.setUserInfo(subject, {
    sub: subject,
    email,
    email_verified: true,
    name: `Name of ${label}`,
  });
  return { subject, email, token: await issuer.sign({ subject }) };
}

async function signIn(person: { token: string }): Promise<Me> {
  const response = await callMe(person.token);
  expect(response.status).toBe(200);
  return (await response.json()) as Me;
}

/** Runs a statement as the table owner. FORCE is switched off first so it also works for a non-superuser owner. */
async function asOwner(sql: string, params: unknown[] = []): Promise<void> {
  const client = await testDb.ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("ALTER TABLE app_user NO FORCE ROW LEVEL SECURITY");
    await client.query("ALTER TABLE organization NO FORCE ROW LEVEL SECURITY");
    await client.query(sql, params);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function countUsersWithIdentity(subject: string): Promise<number> {
  const result = await withTenant(
    testDb.appPool,
    { authIssuer: issuer.issuer, authSubject: subject },
    ({ client }) => client.query<{ n: number }>("SELECT count(*)::int AS n FROM app_user"),
  );
  return result.rows[0]?.n ?? -1;
}

async function addMembership(userId: string, status: "active" | "suspended", name: string) {
  const organizationId = randomUUID();
  await withTenant(testDb.appPool, { organizationId, userId }, async ({ client }) => {
    await client.query(
      "INSERT INTO organization (id, name, slug, timezone) VALUES ($1, $2, $3, 'America/Chicago')",
      [organizationId, name, `org-${organizationId}`],
    );
    await client.query(
      "INSERT INTO membership (organization_id, user_id, status) VALUES ($1, $2, $3)",
      [organizationId, userId, status],
    );
  });
  return organizationId;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  issuer = await startFakeIssuer("project-123");
  app = await NestFactory.create(
    AppModule.forRoot({
      config: { oidcIssuer: issuer.issuer, oidcAudience: issuer.audience },
      pool: testDb.appPool,
      jwksCooldownMs: 0,
    }),
    { logger: false },
  );
  await app.listen(0, "127.0.0.1");
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  await app.close();
  await issuer.close();
  await testDb.drop();
});

describe("GET /v1/me without valid credentials", () => {
  it("answers 401 with a challenge when there is no Authorization header", async () => {
    const response = await callMe();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  it.each(["Basic abc", "Bearer", "Bearer a b", "bearer-without-space"])(
    "answers 401 for the Authorization header %j",
    async (header) => {
      const response = await fetch(`${baseUrl}/v1/me`, { headers: { authorization: header } });
      expect(response.status).toBe(401);
    },
  );

  it("answers 401 for a rejected token and does not reveal why", async () => {
    const expired = await issuer.sign({ expiresAt: Math.floor(Date.now() / 1000) - 600 });
    const response = await callMe(expired);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("invalid_token");
    expect(JSON.stringify(await response.json())).not.toMatch(/expired|signature|audience|issuer/i);
  });

  it("answers 401 for a token with the wrong audience", async () => {
    expect((await callMe(await issuer.sign({ audience: "other-api" }))).status).toBe(401);
  });

  it("does not create a user for a rejected token", async () => {
    const subject = `rejected-${randomUUID()}`;
    issuer.setUserInfo(subject, {
      sub: subject,
      email: `${subject}@example.com`,
      email_verified: true,
    });
    await callMe(await issuer.sign({ subject, audience: "other-api" }));
    expect(await countUsersWithIdentity(subject)).toBe(0);
  });
});

describe("first sign-in", () => {
  it("registers the person and returns an empty organization list", async () => {
    const person = await newVerifiedPerson();
    const before = issuer.userInfoCalls;

    const me = await signIn(person);

    expect(me.user.email).toBe(person.email);
    expect(me.user.displayName).toBe("Name of person");
    expect(me.organizations).toEqual([]);
    expect(issuer.userInfoCalls).toBe(before + 1);
    expect(await countUsersWithIdentity(person.subject)).toBe(1);
  });

  it("recognizes the person afterwards without asking the provider again", async () => {
    const person = await newVerifiedPerson();
    const first = await signIn(person);
    const calls = issuer.userInfoCalls;

    const second = await signIn({ token: await issuer.sign({ subject: person.subject }) });

    expect(second.user.id).toBe(first.user.id);
    expect(issuer.userInfoCalls).toBe(calls);
  });

  it("registers exactly one person when the first requests arrive in parallel", async () => {
    const person = await newVerifiedPerson("parallel");
    const responses = await Promise.all(Array.from({ length: 6 }, () => callMe(person.token)));
    expect(responses.map((response) => response.status)).toEqual(Array(6).fill(200));
    const ids = new Set(
      (await Promise.all(responses.map((response) => response.json() as Promise<Me>))).map(
        (me) => me.user.id,
      ),
    );
    expect(ids.size).toBe(1);
    expect(await countUsersWithIdentity(person.subject)).toBe(1);
  });

  it("refuses a person whose e-mail address the provider has not verified", async () => {
    const subject = `unverified-${randomUUID()}`;
    issuer.setUserInfo(subject, {
      sub: subject,
      email: `${subject}@example.com`,
      email_verified: false,
    });
    const response = await callMe(await issuer.sign({ subject }));
    expect(response.status).toBe(403);
    expect(await countUsersWithIdentity(subject)).toBe(0);
  });

  it("refuses a person for whom the provider sends no e-mail address", async () => {
    const subject = `no-email-${randomUUID()}`;
    issuer.setUserInfo(subject, { sub: subject });
    expect((await callMe(await issuer.sign({ subject }))).status).toBe(403);
    expect(await countUsersWithIdentity(subject)).toBe(0);
  });

  it("does not link a new identity to an existing account with the same e-mail address", async () => {
    const owner = await newVerifiedPerson("owner");
    await signIn(owner);

    const subject = `intruder-${randomUUID()}`;
    issuer.setUserInfo(subject, {
      sub: subject,
      email: owner.email.toUpperCase(),
      email_verified: true,
    });
    const response = await callMe(await issuer.sign({ subject }));

    expect(response.status).toBe(409);
    expect(await countUsersWithIdentity(subject)).toBe(0);
  });

  it("answers 503 when a new person cannot be checked because the provider is down", async () => {
    const person = await newVerifiedPerson("late");
    await issuer.down();
    try {
      // The token itself cannot be verified without the provider's keys only if they were never fetched;
      // the keys are cached by now, so the failing step is the userinfo request.
      const response = await callMe(person.token);
      expect(response.status).toBe(503);
    } finally {
      await issuer.up();
    }
    expect((await callMe(person.token)).status).toBe(200);
  });
});

describe("existing accounts", () => {
  it("refuses a deactivated account", async () => {
    const person = await newVerifiedPerson("deactivated");
    const me = await signIn(person);
    await asOwner("UPDATE app_user SET deactivated_at = now() WHERE id = $1", [me.user.id]);
    expect((await callMe(person.token)).status).toBe(403);
  });

  it("lists active memberships of the person, and only theirs", async () => {
    const alice = await newVerifiedPerson("alice");
    const bob = await newVerifiedPerson("bob");
    const aliceId = (await signIn(alice)).user.id;
    const bobId = (await signIn(bob)).user.id;

    const orgB = await addMembership(aliceId, "active", "B Logistics");
    const orgA = await addMembership(aliceId, "active", "A Freight");
    await addMembership(aliceId, "suspended", "Suspended Co");
    await addMembership(bobId, "active", "Bobs Only");

    const me = await signIn(alice);
    expect(me.organizations.map((organization) => organization.id)).toEqual([orgA, orgB]);
    expect(me.organizations.map((organization) => organization.name)).toEqual([
      "A Freight",
      "B Logistics",
    ]);
    expect(me.organizations[0]).toMatchObject({ slug: `org-${orgA}`, region: "us" });
  });

  it("hides organizations that were deleted", async () => {
    const person = await newVerifiedPerson("deleted-org");
    const userId = (await signIn(person)).user.id;
    const organizationId = await addMembership(userId, "active", "Gone Inc");
    await asOwner("UPDATE organization SET deleted_at = now() WHERE id = $1", [organizationId]);

    expect((await signIn(person)).organizations).toEqual([]);
  });
});
