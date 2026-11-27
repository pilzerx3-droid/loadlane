// End-to-end tests of the master data modules (customers, carriers, locations): permissions per
// role, create / read / change / archive, validation, search, audit entries and tenant isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "../testing/harness.ts";

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
});

type Json = Record<string, unknown>;

async function body(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

async function memberWith(roles: string[]) {
  const person = await api.person("member");
  const organizationId = await api.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles }],
  });
  return { person, organizationId };
}

interface Kind {
  path: string;
  table: string;
  read: string;
  manage: string;
  valid: Json;
  changed: Json;
  invalid: Json;
  searchTerm: string;
  uniqueName: boolean;
}

const KINDS: Kind[] = [
  {
    path: "/v1/customers",
    table: "customer",
    read: "customer:read",
    manage: "customer:manage",
    valid: { name: "Acme Foods", contactEmail: "buyer@acme.example", notes: "  Net 30  " },
    changed: { contactName: "Pat Buyer" },
    invalid: { name: "X", contactEmail: "not-an-email" },
    searchTerm: "acme",
    uniqueName: true,
  },
  {
    path: "/v1/carriers",
    table: "carrier",
    read: "carrier:read",
    manage: "carrier:manage",
    valid: { name: "Blue Line Trucking", mcNumber: "MC-123456", dotNumber: "1234567" },
    changed: { contactPhone: "555-0100" },
    invalid: { name: "Y", contactEmail: "nope" },
    searchTerm: "mc-1234",
    uniqueName: true,
  },
  {
    path: "/v1/locations",
    table: "location",
    read: "location:read",
    manage: "location:manage",
    valid: {
      name: "Dallas DC",
      addressLine1: "1 Main St",
      city: "Dallas",
      state: "tx",
      postalCode: "75001",
      timezone: "America/Chicago",
    },
    changed: { notes: "Dock 4" },
    invalid: { name: "Z", state: "Texas", postalCode: "ABC", timezone: "Mars/Base" },
    searchTerm: "dallas",
    uniqueName: false,
  },
];

// Who may read and who may manage, written out per role and kind (ADR 0010).
const ROLE_ACCESS: Record<string, Record<string, [read: boolean, manage: boolean]>> = {
  admin: { customer: [true, true], carrier: [true, true], location: [true, true] },
  dispatcher: { customer: [true, true], carrier: [true, true], location: [true, true] },
  sales: { customer: [true, true], carrier: [true, false], location: [true, true] },
  carrier_user: { customer: [false, false], carrier: [false, false], location: [false, false] },
};

describe.each(KINDS)("$path", (kind) => {
  describe("permissions", () => {
    it.each(Object.keys(ROLE_ACCESS))("%s", async (role) => {
      const [canRead, canManage] = ROLE_ACCESS[role]?.[kind.table] ?? [false, false];
      const { person, organizationId } = await memberWith([role]);
      const list = await api.call(kind.path, { token: person.token, organizationId });
      expect(list.status).toBe(canRead ? 200 : 403);
      const create = await api.call(kind.path, {
        token: person.token,
        organizationId,
        json: kind.valid,
      });
      expect(create.status).toBe(canManage ? 201 : 403);
    });

    it("needs a token", async () => {
      const { organizationId } = await memberWith(["admin"]);
      expect((await api.call(kind.path, { organizationId })).status).toBe(401);
    });
  });

  describe("life cycle", () => {
    it("creates, reads, changes, archives and restores a record", async () => {
      const { person, organizationId } = await memberWith(["admin"]);
      const as = { token: person.token, organizationId };

      const created = await api.call(kind.path, { ...as, json: kind.valid });
      expect(created.status).toBe(201);
      const record = await body(created);
      expect(record["id"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(record["archivedAt"]).toBeNull();

      const id = String(record["id"]);
      const fetched = await body(await api.call(`${kind.path}/${id}`, as));
      expect(fetched["name"]).toBe(kind.valid["name"]);

      const patched = await api.call(`${kind.path}/${id}`, {
        ...as,
        method: "PATCH",
        json: kind.changed,
      });
      expect(patched.status).toBe(200);
      expect(await body(patched)).toMatchObject(kind.changed);

      const archived = await body(
        await api.call(`${kind.path}/${id}`, { ...as, method: "PATCH", json: { archived: true } }),
      );
      expect(archived["archivedAt"]).not.toBeNull();

      const active = await body(await api.call(kind.path, as));
      expect((active["items"] as Json[]).map((item) => item["id"])).not.toContain(id);
      const all = await body(await api.call(`${kind.path}?includeArchived=true`, as));
      expect((all["items"] as Json[]).map((item) => item["id"])).toContain(id);

      const restored = await body(
        await api.call(`${kind.path}/${id}`, { ...as, method: "PATCH", json: { archived: false } }),
      );
      expect(restored["archivedAt"]).toBeNull();
    });

    it("writes one audit entry per change, without a client address", async () => {
      const { person, organizationId } = await memberWith(["admin"]);
      const as = { token: person.token, organizationId };
      const record = await body(await api.call(kind.path, { ...as, json: kind.valid }));
      const id = String(record["id"]);
      await api.call(`${kind.path}/${id}`, { ...as, method: "PATCH", json: kind.changed });
      await api.call(`${kind.path}/${id}`, { ...as, method: "PATCH", json: { archived: true } });

      const rows = await api.db.ownerPool.query<{ action: string; ip: string | null }>(
        "SELECT action, ip FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at, id",
        [id],
      );
      expect(rows.rows.map((row) => row.action)).toEqual([
        `${kind.table}.created`,
        `${kind.table}.updated`,
        `${kind.table}.archived`,
      ]);
      expect(rows.rows.every((row) => row.ip === null)).toBe(true);
    });

    it("does not write an audit entry when nothing changes", async () => {
      const { person, organizationId } = await memberWith(["admin"]);
      const as = { token: person.token, organizationId };
      const record = await body(await api.call(kind.path, { ...as, json: kind.valid }));
      const id = String(record["id"]);
      await api.call(`${kind.path}/${id}`, { ...as, method: "PATCH", json: {} });
      const rows = await api.db.ownerPool.query("SELECT 1 FROM audit_log WHERE entity_id = $1", [
        id,
      ]);
      expect(rows.rowCount).toBe(1);
    });
  });

  describe("input", () => {
    it("rejects invalid values with field errors", async () => {
      const { person, organizationId } = await memberWith(["admin"]);
      const response = await api.call(kind.path, {
        token: person.token,
        organizationId,
        json: kind.invalid,
      });
      expect(response.status).toBe(400);
      expect(await body(response)).toMatchObject({ code: "validation_failed" });
    });

    it("rejects fields it does not know, such as an organization id", async () => {
      const { person, organizationId } = await memberWith(["admin"]);
      const response = await api.call(kind.path, {
        token: person.token,
        organizationId,
        json: { ...kind.valid, organizationId: "00000000-0000-4000-8000-000000000000" },
      });
      expect(response.status).toBe(400);
    });

    it("answers 400 for an id that is not a UUID and 404 for an unknown one", async () => {
      const { person, organizationId } = await memberWith(["admin"]);
      const as = { token: person.token, organizationId };
      expect((await api.call(`${kind.path}/not-a-uuid`, as)).status).toBe(400);
      expect((await api.call(`${kind.path}/00000000-0000-4000-8000-000000000000`, as)).status).toBe(
        404,
      );
    });
  });

  describe("list", () => {
    it("pages, sorts by name and searches case-insensitively", async () => {
      const { person, organizationId } = await memberWith(["admin"]);
      const as = { token: person.token, organizationId };
      for (const name of ["Charlie", "alpha", "Bravo"]) {
        await api.call(kind.path, { ...as, json: { ...kind.valid, name } });
      }
      const page = await body(await api.call(`${kind.path}?limit=2`, as));
      expect((page["items"] as Json[]).map((item) => item["name"])).toEqual(["alpha", "Bravo"]);
      expect(page["page"]).toEqual({ limit: 2, offset: 0, total: 3 });
      const second = await body(await api.call(`${kind.path}?limit=2&offset=2`, as));
      expect((second["items"] as Json[]).map((item) => item["name"])).toEqual(["Charlie"]);

      const found = await body(
        await api.call(`${kind.path}?q=${encodeURIComponent(kind.searchTerm.toUpperCase())}`, as),
      );
      expect((found["page"] as Json)["total"]).toBe(3);
    });

    it("treats % and _ in a search as plain characters", async () => {
      const { person, organizationId } = await memberWith(["admin"]);
      const as = { token: person.token, organizationId };
      await api.call(kind.path, { ...as, json: kind.valid });
      const found = await body(await api.call(`${kind.path}?q=${encodeURIComponent("%")}`, as));
      expect((found["page"] as Json)["total"]).toBe(0);
    });
  });

  if (kind.uniqueName) {
    it("refuses a second active record with the same name, ignoring case, but allows it after archiving", async () => {
      const { person, organizationId } = await memberWith(["admin"]);
      const as = { token: person.token, organizationId };
      const first = await body(await api.call(kind.path, { ...as, json: kind.valid }));
      const duplicate = await api.call(kind.path, {
        ...as,
        json: { ...kind.valid, name: String(kind.valid["name"]).toUpperCase() },
      });
      expect(duplicate.status).toBe(409);
      expect(await body(duplicate)).toMatchObject({ code: "name_taken" });

      await api.call(`${kind.path}/${String(first["id"])}`, {
        ...as,
        method: "PATCH",
        json: { archived: true },
      });
      expect((await api.call(kind.path, { ...as, json: kind.valid })).status).toBe(201);
    });
  }

  describe("tenant isolation", () => {
    it("shows organization B nothing of organization A, by list or by id", async () => {
      const a = await memberWith(["admin"]);
      const b = await memberWith(["admin"]);
      const record = await body(
        await api.call(kind.path, {
          token: a.person.token,
          organizationId: a.organizationId,
          json: kind.valid,
        }),
      );
      const id = String(record["id"]);
      const asB = { token: b.person.token, organizationId: b.organizationId };

      expect((await body(await api.call(kind.path, asB)))["items"]).toEqual([]);
      expect((await api.call(`${kind.path}/${id}`, asB)).status).toBe(404);
      const patch = await api.call(`${kind.path}/${id}`, {
        ...asB,
        method: "PATCH",
        json: { archived: true },
      });
      expect(patch.status).toBe(404);

      // Untouched in A.
      const stillThere = await body(
        await api.call(`${kind.path}/${id}`, {
          token: a.person.token,
          organizationId: a.organizationId,
        }),
      );
      expect(stillThere["archivedAt"]).toBeNull();
    });

    it("lets two organizations use the same name", async () => {
      const a = await memberWith(["admin"]);
      const b = await memberWith(["admin"]);
      for (const side of [a, b]) {
        const response = await api.call(kind.path, {
          token: side.person.token,
          organizationId: side.organizationId,
          json: kind.valid,
        });
        expect(response.status).toBe(201);
      }
    });
  });
});

describe("location details", () => {
  it("stores the state in upper case and the canonical time zone, and defaults the country to US", async () => {
    const { person, organizationId } = await memberWith(["dispatcher"]);
    const response = await api.call("/v1/locations", {
      token: person.token,
      organizationId,
      json: {
        name: "Denver Yard",
        addressLine1: "9 Ridge Rd",
        city: "Denver",
        state: "co",
        postalCode: "80202-1234",
        timezone: "America/Denver",
      },
    });
    expect(response.status).toBe(201);
    expect(await body(response)).toMatchObject({
      state: "CO",
      country: "US",
      timezone: "America/Denver",
      postalCode: "80202-1234",
    });
  });
});
