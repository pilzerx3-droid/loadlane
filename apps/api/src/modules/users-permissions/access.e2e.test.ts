// End-to-end tests of roles and permissions (ADR 0010): who may call what, in which organization.
import { randomUUID } from "node:crypto";
import { ROLES } from "@loadlane/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "../testing/harness.ts";

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
});

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/** A person who holds the given roles in a fresh organization. */
async function memberWith(
  roles: string[],
  status: "active" | "invited" | "suspended" | "removed" = "active",
) {
  const person = await api.person("member");
  const organizationId = await api.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, status, roles }],
  });
  return { person, organizationId };
}

describe("signing in and naming the organization", () => {
  it("answers 401 without a token, even with an organization header", async () => {
    const { organizationId } = await memberWith(["admin"]);
    expect((await api.call("/v1/organization", { organizationId })).status).toBe(401);
  });

  it("answers 400 when the organization header is missing", async () => {
    const { person } = await memberWith(["admin"]);
    const response = await api.call("/v1/organization", { token: person.token });
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ code: "organization_required" });
  });

  it.each([
    "not-a-uuid",
    "",
    "12345678-1234-1234-1234-12345678901",
    `${randomUUID()}, ${randomUUID()}`,
  ])("answers 400 for the organization header %j", async (value) => {
    const { person } = await memberWith(["admin"]);
    const response = await api.call("/v1/organization", {
      token: person.token,
      headers: { "x-organization-id": value },
    });
    expect(response.status).toBe(400);
  });

  it("accepts the organization id in upper case", async () => {
    const { person, organizationId } = await memberWith(["admin"]);
    const response = await api.call("/v1/organization", {
      token: person.token,
      organizationId: organizationId.toUpperCase(),
    });
    expect(response.status).toBe(200);
  });

  it("needs no organization for /v1/me", async () => {
    const { person } = await memberWith(["carrier_user"]);
    expect((await api.call("/v1/me", { token: person.token })).status).toBe(200);
  });
});

describe("role matrix", () => {
  // Written out on purpose: what each role gets from the two endpoints.
  const cases: [role: string, organization: number, members: number][] = [
    ["admin", 200, 200],
    ["dispatcher", 200, 200],
    ["sales", 200, 200],
    ["carrier_user", 200, 403],
  ];

  it("covers every role of the catalog", () => {
    expect(cases.map(([role]) => role).sort()).toEqual([...ROLES].sort());
  });

  it.each(cases)(
    "%s: GET /v1/organization -> %i, GET /v1/members -> %i",
    async (role, organization, members) => {
      const { person, organizationId } = await memberWith([role]);

      const organizationResponse = await api.call("/v1/organization", {
        token: person.token,
        organizationId,
      });
      expect(organizationResponse.status).toBe(organization);

      const membersResponse = await api.call("/v1/members", {
        token: person.token,
        organizationId,
      });
      expect(membersResponse.status).toBe(members);
      if (members === 403)
        expect(await body(membersResponse)).toMatchObject({ code: "permission_denied" });
    },
  );

  it("adds up the permissions of several roles", async () => {
    const { person, organizationId } = await memberWith(["carrier_user", "dispatcher"]);
    expect((await api.call("/v1/members", { token: person.token, organizationId })).status).toBe(
      200,
    );
  });

  it("grants nothing to an active member without any role", async () => {
    const { person, organizationId } = await memberWith([]);
    for (const path of ["/v1/organization", "/v1/members"]) {
      const response = await api.call(path, { token: person.token, organizationId });
      expect(response.status, path).toBe(403);
      expect(await body(response)).toMatchObject({ code: "permission_denied" });
    }
  });
});

describe("memberships that do not count", () => {
  it.each(["invited", "suspended", "removed"] as const)(
    "%s members are refused",
    async (status) => {
      const { person, organizationId } = await memberWith(["admin"], status);
      const response = await api.call("/v1/organization", { token: person.token, organizationId });
      expect(response.status).toBe(403);
      expect(await body(response)).toMatchObject({ code: "forbidden" });
    },
  );

  it("refuses members of an organization that has been deleted", async () => {
    const { person, organizationId } = await memberWith(["admin"]);
    await api.asOwner("UPDATE organization SET deleted_at = now() WHERE id = $1", [organizationId]);
    expect(
      (await api.call("/v1/organization", { token: person.token, organizationId })).status,
    ).toBe(403);
  });
});

describe("organizations stay apart", () => {
  it("answers the same way for an unknown organization and one the caller does not belong to", async () => {
    const outsider = await api.person("outsider");
    const owner = await memberWith(["admin"]);

    const unknown = await api.call("/v1/organization", {
      token: outsider.token,
      organizationId: randomUUID(),
    });
    const foreign = await api.call("/v1/organization", {
      token: outsider.token,
      organizationId: owner.organizationId,
    });

    expect(unknown.status).toBe(403);
    expect(foreign.status).toBe(403);
    expect(await body(foreign)).toEqual(await body(unknown));
  });

  it("applies a role only in the organization where it is held", async () => {
    const person = await api.person("two-orgs");
    const adminOrg = await api.seedOrganization({
      creatorUserId: person.id,
      name: "Admin Org",
      members: [{ userId: person.id, roles: ["admin"] }],
    });
    const carrierOrg = await api.seedOrganization({
      creatorUserId: person.id,
      name: "Carrier Org",
      members: [{ userId: person.id, roles: ["carrier_user"] }],
    });

    expect(
      (await api.call("/v1/members", { token: person.token, organizationId: adminOrg })).status,
    ).toBe(200);
    const denied = await api.call("/v1/members", {
      token: person.token,
      organizationId: carrierOrg,
    });
    expect(denied.status).toBe(403);
    expect(await body(denied)).toMatchObject({ code: "permission_denied" });

    const organization = await api.call("/v1/organization", {
      token: person.token,
      organizationId: carrierOrg,
    });
    expect(await body(organization)).toMatchObject({ id: carrierOrg, name: "Carrier Org" });
  });

  it("lists only the members of the named organization", async () => {
    const a = await api.person("a");
    const b = await api.person("b");
    const orgA = await api.seedOrganization({
      creatorUserId: a.id,
      members: [{ userId: a.id, roles: ["admin"] }],
    });
    await api.seedOrganization({
      creatorUserId: b.id,
      members: [{ userId: b.id, roles: ["admin"] }],
    });

    const response = await api.call("/v1/members", { token: a.token, organizationId: orgA });
    const { members } = (await body(response)) as { members: { email: string }[] };
    expect(members.map((member) => member.email)).toEqual([a.email]);
  });
});

describe("responses", () => {
  it("returns the organization with its unit and locale defaults", async () => {
    const { person, organizationId } = await memberWith(["sales"]);
    const response = await api.call("/v1/organization", { token: person.token, organizationId });
    expect(await body(response)).toEqual({
      id: organizationId,
      name: "Test Organization",
      slug: `org-${organizationId}`,
      region: "us",
      distanceUnit: "mi",
      weightUnit: "lb",
      currency: "USD",
      locale: "en-US",
      timezone: "America/Chicago",
    });
  });

  it("lists members with status and roles, sorted by e-mail", async () => {
    const admin = await api.person("admin");
    const dispatcher = await api.person("dispatcher");
    const invited = await api.person("invited");
    const organizationId = await api.seedOrganization({
      creatorUserId: admin.id,
      members: [
        { userId: admin.id, roles: ["admin"] },
        { userId: dispatcher.id, roles: ["sales", "dispatcher"] },
        { userId: invited.id, status: "invited", roles: [] },
      ],
    });

    const response = await api.call("/v1/members", { token: admin.token, organizationId });
    const { members } = (await body(response)) as { members: Record<string, unknown>[] };

    const byEmail = new Map(members.map((member) => [member["email"], member]));
    expect(members.map((member) => member["email"])).toEqual(
      [admin.email, dispatcher.email, invited.email].sort(),
    );
    expect(byEmail.get(dispatcher.email)).toMatchObject({
      userId: dispatcher.id,
      status: "active",
      roles: ["dispatcher", "sales"],
    });
    expect(byEmail.get(invited.email)).toMatchObject({ status: "invited", roles: [] });
  });
});

describe("role catalog", () => {
  it("has the same roles in the database and in the code", async () => {
    const rows = await api.db.ownerPool.query<{ key: string }>("SELECT key FROM role ORDER BY key");
    expect(rows.rows.map((row) => row.key)).toEqual([...ROLES].sort());
  });
});
