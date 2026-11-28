// End-to-end tests of tariffs: immutable dated versions, applying a tariff to a shipment, the
// record of tariff versions in a frozen calculation, permissions and tenant isolation.
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

const lines = [
  { kind: "mileage", label: "Line haul", unit: "mile", rateCents: 235 },
  {
    kind: "loading",
    label: "Pallet handling",
    unit: "pallet",
    rateCents: 1_250,
    minimumCents: 5_000,
  },
  { kind: "base_freight", label: "Booking fee", unit: "flat", rateCents: 2_500 },
];

async function workspace(role = "admin") {
  const person = await api.person("tariffs");
  const organizationId = await api.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles: [role] }],
  });
  return { as: { token: person.token, organizationId }, organizationId };
}

const create = (w: Awaited<ReturnType<typeof workspace>>, extra: Json = {}) =>
  api.call("/v1/tariffs", {
    ...w.as,
    json: { name: "Acme 2030", kind: "sell", validFrom: "2030-01-01", lines, ...extra },
  });

describe("creating and versioning", () => {
  it("creates a tariff with a first version and shows it", async () => {
    const w = await workspace();
    const customer = await body(
      await api.call("/v1/customers", { ...w.as, json: { name: "Acme" } }),
    );
    const response = await create(w, { customerId: customer["id"], note: "Initial rates" });
    expect(response.status).toBe(201);
    const made = await body(response);
    expect(made).toMatchObject({
      name: "Acme 2030",
      kind: "sell",
      party: { name: "Acme" },
      versions: 1,
      latestValidFrom: "2030-01-01",
      archived: false,
    });
    const first = (made["allVersions"] as Json[])[0] as Json;
    expect(first).toMatchObject({ version: 1, validFrom: "2030-01-01", note: "Initial rates" });
    expect((first["lines"] as Json[])[1]).toMatchObject({
      unit: "pallet",
      rateCents: 1_250,
      minimumCents: 5_000,
    });
  });

  it("adds versions without changing old ones, numbering them and refusing a taken start date", async () => {
    const w = await workspace();
    const made = await body(await create(w));
    const id = String(made["id"]);
    const faster = lines.map((line) => ({ ...line, rateCents: line.rateCents + 10 }));
    const second = await api.call(`/v1/tariffs/${id}/versions`, {
      ...w.as,
      json: { validFrom: "2030-07-01", lines: faster, note: "Summer" },
    });
    expect(second.status).toBe(201);
    const detail = await body(second);
    const versions = detail["allVersions"] as Json[];
    expect(versions.map((v) => [v["version"], v["validFrom"]])).toEqual([
      [2, "2030-07-01"],
      [1, "2030-01-01"],
    ]);
    expect(((versions[1] as Json)["lines"] as Json[])[0]).toMatchObject({ rateCents: 235 }); // unchanged
    const taken = await api.call(`/v1/tariffs/${id}/versions`, {
      ...w.as,
      json: { validFrom: "2030-07-01", lines },
    });
    expect(taken.status).toBe(409);
    expect((await body(taken))["code"]).toBe("version_date_taken");
    const stored = await api.ownerRows(
      "SELECT version, lines FROM tariff_version WHERE tariff_id = $1 ORDER BY version",
      [id],
    );
    expect(stored).toHaveLength(2);
  });

  it("checks the party, the lines and the dates", async () => {
    const w = await workspace();
    const carrier = await body(
      await api.call("/v1/carriers", { ...w.as, json: { name: "Blue Line" } }),
    );
    expect((await create(w, { kind: "sell", carrierId: carrier["id"] })).status).toBe(400);
    expect((await create(w, { kind: "buy", carrierId: carrier["id"] })).status).toBe(201);
    expect((await create(w, { lines: [] })).status).toBe(400);
    expect((await create(w, { lines: [{ ...lines[0], unit: "furlong" }] })).status).toBe(400);
    expect((await create(w, { lines: [{ ...lines[0], rateCents: -1 }] })).status).toBe(400);
    expect((await create(w, { validFrom: "soon" })).status).toBe(400);
    expect((await create(w, { customerId: "11111111-1111-4111-8111-111111111111" })).status).toBe(
      400,
    );
  });

  it("archives and restores, and refuses new versions while archived", async () => {
    const w = await workspace();
    const id = String((await body(await create(w)))["id"]);
    const archived = await body(await api.call(`/v1/tariffs/${id}/archive`, { ...w.as, json: {} }));
    expect(archived["archived"]).toBe(true);
    expect((await body(await api.call("/v1/tariffs", w.as)))["items"]).toEqual([]);
    expect(
      ((await body(await api.call("/v1/tariffs?archived=true", w.as)))["items"] as Json[]).length,
    ).toBe(1);
    const blocked = await api.call(`/v1/tariffs/${id}/versions`, {
      ...w.as,
      json: { validFrom: "2031-01-01", lines },
    });
    expect((await body(blocked))["code"]).toBe("tariff_archived");
    await api.call(`/v1/tariffs/${id}/restore`, { ...w.as, json: {} });
    expect(((await body(await api.call("/v1/tariffs", w.as)))["items"] as Json[]).length).toBe(1);
  });
});

describe("applying a tariff", () => {
  it("prices a shipment with the version in force on the date and names that version", async () => {
    const w = await workspace();
    const id = String((await body(await create(w)))["id"]);
    await api.call(`/v1/tariffs/${id}/versions`, {
      ...w.as,
      json: { validFrom: "2030-07-01", lines: lines.map((line) => ({ ...line, rateCents: 300 })) },
    });
    const apply = (date: string, quantities: Json) =>
      api.call(`/v1/tariffs/${id}/apply`, { ...w.as, json: { date, quantities } });

    const spring = await body(await apply("2030-03-15", { mile: 412.5, pallet: 8 }));
    expect(spring).toMatchObject({ version: 1, validFrom: "2030-01-01", totalCents: 109_438 });
    expect((spring["lines"] as Json[]).map((line) => line["amountCents"])).toEqual([
      96_938, 10_000, 2_500,
    ]);
    expect((spring["lines"] as Json[])[0]).toMatchObject({
      basis: { rateCents: 235, quantityThousandths: 412_500, unit: "mile" },
    });

    const summer = await body(await apply("2030-08-01", { mile: 100, pallet: 1 }));
    expect(summer).toMatchObject({ version: 2 });
    // 1 pallet at $12.50 is below the $50 minimum.
    expect((summer["lines"] as Json[])[1]).toMatchObject({
      amountCents: 5_000,
      minimumApplied: true,
    });
  });

  it("refuses when no version is in force and when a needed quantity is missing", async () => {
    const w = await workspace();
    const id = String((await body(await create(w)))["id"]);
    const early = await api.call(`/v1/tariffs/${id}/apply`, {
      ...w.as,
      json: { date: "2029-12-31", quantities: { mile: 1, pallet: 1 } },
    });
    expect(early.status).toBe(409);
    expect((await body(early))["code"]).toBe("no_version_in_force");
    const missing = await api.call(`/v1/tariffs/${id}/apply`, {
      ...w.as,
      json: { date: "2030-02-01", quantities: { mile: 10 } },
    });
    expect(missing.status).toBe(400);
    expect(JSON.stringify(await body(missing))).toContain("quantities.pallet");
  });
});

describe("tariffs inside a frozen calculation", () => {
  it("records the exact versions used and keeps them when newer versions appear", async () => {
    const w = await workspace();
    const id = String((await body(await create(w)))["id"]);
    const applied = await body(
      await api.call(`/v1/tariffs/${id}/apply`, {
        ...w.as,
        json: { date: "2030-03-01", quantities: { mile: 100, pallet: 4 } },
      }),
    );
    const made = await body(
      await api.call("/v1/calculations", {
        ...w.as,
        json: {
          name: "From tariff",
          tariffVersionIds: [applied["versionId"]],
          lines: (applied["lines"] as Json[]).map((line) => ({
            kind: line["kind"],
            label: line["label"],
            amountCents: line["amountCents"],
          })),
          pricing: { mode: "markup", rateBp: 1_000 },
        },
      }),
    );
    expect(made["tariffVersions"]).toEqual([
      {
        tariffId: id,
        tariffName: "Acme 2030",
        versionId: applied["versionId"],
        version: 1,
        validFrom: "2030-01-01",
      },
    ]);
    await api.call(`/v1/tariffs/${id}/versions`, {
      ...w.as,
      json: { validFrom: "2031-01-01", lines },
    });
    const read = await body(await api.call(`/v1/calculations/${String(made["id"])}`, w.as));
    expect(read["tariffVersions"]).toEqual(made["tariffVersions"]);
    const plain = await body(
      await api.call("/v1/calculations", {
        ...w.as,
        json: {
          name: "No tariff",
          lines: [{ kind: "toll", label: "x", amountCents: 1 }],
          pricing: { mode: "markup", rateBp: 0 },
        },
      }),
    );
    expect(plain["tariffVersions"]).toEqual([]);
    const bad = await api.call("/v1/calculations", {
      ...w.as,
      json: {
        name: "x",
        tariffVersionIds: ["11111111-1111-4111-8111-111111111111"],
        lines: [{ kind: "toll", label: "x", amountCents: 1 }],
        pricing: { mode: "markup", rateBp: 0 },
      },
    });
    expect(bad.status).toBe(400);
  });
});

describe("permissions and isolation", () => {
  it.each([
    ["admin", 200, 201],
    ["dispatcher", 200, 403],
    ["sales", 200, 201],
    ["carrier_user", 403, 403],
  ])("%s: read -> %i, create -> %i", async (role, read, createStatus) => {
    const admin = await workspace();
    let as = admin.as;
    if (role !== "admin") {
      const person = await api.person(role);
      await api.asOwner(
        "INSERT INTO membership (organization_id, user_id, status) VALUES ($1, $2, 'active')",
        [admin.organizationId, person.id],
      );
      await api.asOwner(
        "INSERT INTO membership_role (organization_id, membership_id, role_key) SELECT organization_id, id, $3 FROM membership WHERE user_id = $1 AND organization_id = $2",
        [person.id, admin.organizationId, role],
      );
      as = { token: person.token, organizationId: admin.organizationId };
    }
    expect((await api.call("/v1/tariffs", as)).status).toBe(read);
    const response = await api.call("/v1/tariffs", {
      ...as,
      json: { name: "x", kind: "sell", validFrom: "2030-01-01", lines },
    });
    expect(response.status).toBe(createStatus);
  });

  it("keeps tariffs of one organization invisible and unchangeable for another, and audits changes", async () => {
    const a = await workspace();
    const b = await workspace();
    const id = String((await body(await create(a)))["id"]);
    expect(await body(await api.call("/v1/tariffs", b.as))).toMatchObject({ items: [] });
    expect((await api.call(`/v1/tariffs/${id}`, b.as)).status).toBe(404);
    expect(
      (
        await api.call(`/v1/tariffs/${id}/versions`, {
          ...b.as,
          json: { validFrom: "2031-01-01", lines },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await api.call(`/v1/tariffs/${id}/apply`, {
          ...b.as,
          json: { date: "2030-02-01", quantities: {} },
        })
      ).status,
    ).toBe(404);
    expect((await api.call(`/v1/tariffs/${id}/archive`, { ...b.as, json: {} })).status).toBe(404);
    const audit = await body(await api.call("/v1/audit?entityType=tariff", a.as));
    expect((audit["items"] as Json[]).map((item) => item["action"])).toEqual(["tariff.created"]);
  });
});
