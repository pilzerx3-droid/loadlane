// End-to-end tests of creating organizations and of roles in GET /v1/me (backlog P1-09).
// Real app, real database with row-level security, fake issuer.
import { randomUUID } from "node:crypto";
import { withTenant } from "@loadlane/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "../../testing/harness.ts";
import { slugify } from "./organization.schemas.ts";

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi({ maxOrganizationsPerUser: 3 });
});

afterAll(async () => {
  await api.close();
});

type Json = Record<string, unknown>;

async function json(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

const valid = { name: "Acme Logistics", timezone: "America/Chicago" };

describe("POST /v1/organizations", () => {
  it("answers 401 without a token", async () => {
    const response = await api.call("/v1/organizations", { json: valid });
    expect(response.status).toBe(401);
  });

  it("creates the organization with US defaults, makes the caller its admin and needs no organization header", async () => {
    const person = await api.person("founder");
    const response = await api.call("/v1/organizations", { token: person.token, json: valid });

    expect(response.status).toBe(201);
    const organization = await json(response);
    expect(organization).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      name: "Acme Logistics",
      slug: "acme-logistics",
      region: "us",
      distanceUnit: "mi",
      weightUnit: "lb",
      currency: "USD",
      locale: "en-US",
      timezone: "America/Chicago",
    });
    // The id is a UUID v7.
    expect(String(organization["id"]).charAt(14)).toBe("7");

    const me = await json(await api.call("/v1/me", { token: person.token }));
    const organizations = me["organizations"] as Json[];
    expect(organizations).toHaveLength(1);
    expect(organizations[0]).toMatchObject({
      id: organization["id"],
      roles: ["admin"],
      permissions: [
        "audit:read",
        "member:manage",
        "member:read",
        "organization:manage",
        "organization:read",
      ],
    });

    const asAdmin = await api.call("/v1/members", {
      token: person.token,
      organizationId: String(organization["id"]),
    });
    expect(asAdmin.status).toBe(200);
    const { members } = (await json(asAdmin)) as { members: Json[] };
    expect(members).toMatchObject([{ userId: person.id, status: "active", roles: ["admin"] }]);
  });

  it("writes an audit entry for the creation", async () => {
    const person = await api.person("audited");
    const response = await api.call("/v1/organizations", {
      token: person.token,
      json: { name: "Audited Co", timezone: "America/New_York" },
    });
    const organizationId = String((await json(response))["id"]);
    const requestId = response.headers.get("x-request-id");

    const rows = await withTenant(
      api.db.appPool,
      { organizationId, userId: person.id },
      ({ client }) =>
        client.query<Json>(
          "SELECT actor_type, actor_user_id, action, entity_type, entity_id, changes, request_id, ip, user_agent FROM audit_log",
        ),
    );
    expect(rows.rows).toEqual([
      {
        actor_type: "user",
        actor_user_id: person.id,
        action: "organization.created",
        entity_type: "organization",
        entity_id: organizationId,
        changes: { name: "Audited Co", slug: "audited-co", timezone: "America/New_York" },
        request_id: requestId,
        ip: null,
        user_agent: null,
      },
    ]);
  });

  it("normalizes the time zone to its canonical name", async () => {
    const person = await api.person("zone");
    const response = await api.call("/v1/organizations", {
      token: person.token,
      json: { name: "Zone Co", timezone: "america/chicago" },
    });
    expect((await json(response))["timezone"]).toBe("America/Chicago");
  });

  it("takes an explicit short name and derives one from the name otherwise", async () => {
    const person = await api.person("slugger");
    const explicit = await api.call("/v1/organizations", {
      token: person.token,
      json: { ...valid, name: "Ünïcode & Söns!", slug: "my-own-slug" },
    });
    expect((await json(explicit))["slug"]).toBe("my-own-slug");

    const derived = await api.call("/v1/organizations", {
      token: person.token,
      json: { ...valid, name: "Ünïcode & Söns!" },
    });
    expect((await json(derived))["slug"]).toBe("unicode-sons");
  });

  it("makes a free short name for a second organization with the same name", async () => {
    const first = await api.person("twin-a");
    const second = await api.person("twin-b");
    const a = await json(
      await api.call("/v1/organizations", {
        token: first.token,
        json: { ...valid, name: "Twin Freight" },
      }),
    );
    const b = await json(
      await api.call("/v1/organizations", {
        token: second.token,
        json: { ...valid, name: "Twin Freight" },
      }),
    );
    expect(a["slug"]).toBe("twin-freight");
    expect(String(b["slug"])).toMatch(/^twin-freight-[0-9a-f]{4}$/);
  });

  it("answers 409 slug_taken when an explicit short name is taken", async () => {
    const first = await api.person("owner");
    const second = await api.person("late");
    await api.call("/v1/organizations", {
      token: first.token,
      json: { ...valid, slug: "taken-name" },
    });
    const response = await api.call("/v1/organizations", {
      token: second.token,
      json: { ...valid, slug: "taken-name" },
    });
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({ code: "slug_taken" });
  });

  it.each([
    ["no name", { timezone: "America/Chicago" }, "name"],
    ["a name that is too short", { name: "A", timezone: "America/Chicago" }, "name"],
    ["a name that is too long", { name: "x".repeat(81), timezone: "America/Chicago" }, "name"],
    ["no time zone", { name: "Valid Name" }, "timezone"],
    ["an unknown time zone", { name: "Valid Name", timezone: "Mars/Phobos" }, "timezone"],
    ["a malformed short name", { name: "Valid Name", timezone: "UTC", slug: "Bad Slug" }, "slug"],
    ["a field that is not allowed", { name: "Valid Name", timezone: "UTC", region: "eu" }, ""],
  ])("answers 400 with field errors for %s", async (_label, body, field) => {
    const person = await api.person("invalid");
    const response = await api.call("/v1/organizations", { token: person.token, json: body });
    expect(response.status).toBe(400);
    const problem = (await json(response)) as { code: string; errors: { path: string }[] };
    expect(problem.code).toBe("validation_failed");
    expect(problem.errors.map((error) => error.path)).toContain(field);
  });

  it("creates nothing when validation fails", async () => {
    const person = await api.person("nothing");
    await api.call("/v1/organizations", { token: person.token, json: { name: "x" } });
    const me = await json(await api.call("/v1/me", { token: person.token }));
    expect(me["organizations"]).toEqual([]);
  });

  it("limits how many organizations one person can create, per person", async () => {
    const busy = await api.person("busy");
    const other = await api.person("other");
    for (let i = 0; i < 3; i++) {
      const created = await api.call("/v1/organizations", {
        token: busy.token,
        json: { ...valid, name: `Busy ${i} ${randomUUID().slice(0, 8)}` },
      });
      expect(created.status).toBe(201);
    }
    const refused = await api.call("/v1/organizations", {
      token: busy.token,
      json: { ...valid, name: "One too many" },
    });
    expect(refused.status).toBe(409);
    expect(await json(refused)).toMatchObject({ code: "organization_limit_reached" });

    const unaffected = await api.call("/v1/organizations", { token: other.token, json: valid });
    expect(unaffected.status).toBe(201);
  });

  it("holds the limit when requests arrive in parallel", async () => {
    const racer = await api.person("racer");
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        api.call("/v1/organizations", {
          token: racer.token,
          json: { ...valid, name: `Race ${i} ${randomUUID().slice(0, 8)}` },
        }),
      ),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 201, 201, 409, 409, 409]);
    const me = await json(await api.call("/v1/me", { token: racer.token }));
    expect(me["organizations"]).toHaveLength(3);
  });

  it("is documented in the OpenAPI document with its request body", async () => {
    const document = (await json(await api.call("/v1/openapi.json"))) as {
      paths: Record<string, Record<string, Json>>;
    };
    const operation = document.paths["/v1/organizations"]?.["post"];
    expect(operation).toBeDefined();
    expect(operation?.["requestBody"]).toMatchObject({ required: true });
    expect((operation?.["responses"] as Json)["201"]).toBeDefined();
    expect((operation?.["responses"] as Json)["400"]).toBeDefined();
    expect(operation?.["x-permissions"]).toBeUndefined();
  });
});

describe("roles and permissions in GET /v1/me", () => {
  it("lists organizations with the roles held there and the permissions they give", async () => {
    const person = await api.person("multi");
    const adminOrg = await api.seedOrganization({
      creatorUserId: person.id,
      name: "A Admin Org",
      members: [{ userId: person.id, roles: ["admin"] }],
    });
    const mixedOrg = await api.seedOrganization({
      creatorUserId: person.id,
      name: "B Mixed Org",
      members: [{ userId: person.id, roles: ["sales", "carrier_user"] }],
    });
    const bareOrg = await api.seedOrganization({
      creatorUserId: person.id,
      name: "C Bare Org",
      members: [{ userId: person.id, roles: [] }],
    });

    const me = await json(await api.call("/v1/me", { token: person.token }));
    const organizations = me["organizations"] as {
      id: string;
      roles: string[];
      permissions: string[];
    }[];
    expect(organizations.map((organization) => organization.id)).toEqual([
      adminOrg,
      mixedOrg,
      bareOrg,
    ]);
    expect(organizations[0]).toMatchObject({ roles: ["admin"] });
    expect(organizations[0]?.permissions).toHaveLength(5);
    expect(organizations[1]).toMatchObject({
      roles: ["carrier_user", "sales"],
      permissions: ["member:read", "organization:read"],
    });
    expect(organizations[2]).toMatchObject({ roles: [], permissions: [] });
  });

  it("shows only the caller's own roles, never other members'", async () => {
    const admin = await api.person("admin");
    const colleague = await api.person("colleague");
    await api.seedOrganization({
      creatorUserId: admin.id,
      members: [
        { userId: admin.id, roles: ["admin"] },
        { userId: colleague.id, roles: ["dispatcher"] },
      ],
    });
    const me = await json(await api.call("/v1/me", { token: colleague.token }));
    expect((me["organizations"] as Json[])[0]).toMatchObject({ roles: ["dispatcher"] });
  });

  it("leaves out suspended memberships", async () => {
    const person = await api.person("suspended");
    await api.seedOrganization({
      creatorUserId: person.id,
      members: [{ userId: person.id, status: "suspended", roles: ["admin"] }],
    });
    const me = await json(await api.call("/v1/me", { token: person.token }));
    expect(me["organizations"]).toEqual([]);
  });
});

describe("slugify", () => {
  it.each([
    ["Acme Logistics", "acme-logistics"],
    ["  Lone Star Freight, Inc.  ", "lone-star-freight-inc"],
    ["Ünïcode & Söns!", "unicode-sons"],
    ["A", "organization"],
    ["!!!", "organization"],
    ["x".repeat(100), "x".repeat(40)],
    ["a-b--c", "a-b-c"],
  ])("turns %j into %j", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });
});
