// End-to-end tests of the freight calculator: the money arithmetic through the API, validation,
// the frozen snapshot, permissions and tenant isolation.
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

async function workspace(role = "admin") {
  const person = await api.person("calc");
  const organizationId = await api.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles: [role] }],
  });
  return { as: { token: person.token, organizationId }, organizationId };
}

const lines = [
  { kind: "base_freight", label: "Carrier rate", amountCents: 85_000 },
  { kind: "accessorial", label: "Liftgate", amountCents: 5_000 },
];

describe("POST /v1/calculations", () => {
  it("prices by markup: $900 cost and 15 % markup is $1,035", async () => {
    const w = await workspace();
    const response = await api.call("/v1/calculations", {
      ...w.as,
      json: { name: "Dallas to Houston", lines, pricing: { mode: "markup", rateBp: 1_500 } },
    });
    expect(response.status).toBe(201);
    expect(await body(response)).toMatchObject({
      name: "Dallas to Houston",
      pricingMode: "markup",
      costCents: 90_000,
      priceCents: 103_500,
      contributionCents: 13_500,
      markupBp: 1_500,
      marginBp: 1_304,
      engineVersion: 1,
      costByKind: { base_freight: 85_000, accessorial: 5_000 },
      pricing: { mode: "markup", rateBp: 1_500 },
    });
  });

  it("prices by margin: the same 15 % gives $1,058.82, a different number than markup", async () => {
    const w = await workspace();
    const made = await body(
      await api.call("/v1/calculations", {
        ...w.as,
        json: { name: "Margin", lines, pricing: { mode: "margin", rateBp: 1_500 } },
      }),
    );
    expect(made).toMatchObject({ priceCents: 105_882, marginBp: 1_500, markupBp: 1_765 });
  });

  it("prices by contribution and by fixed price, including a loss", async () => {
    const w = await workspace();
    const post = async (pricing: Json) =>
      body(await api.call("/v1/calculations", { ...w.as, json: { name: "x", lines, pricing } }));
    expect(await post({ mode: "contribution", amountCents: 13_500 })).toMatchObject({
      priceCents: 103_500,
    });
    expect(await post({ mode: "price", amountCents: 80_000 })).toMatchObject({
      contributionCents: -10_000,
      markupBp: -1_111,
      marginBp: -1_250,
    });
  });

  it("derives a line from a rate and a quantity and keeps how it came about", async () => {
    const w = await workspace();
    const made = await body(
      await api.call("/v1/calculations", {
        ...w.as,
        json: {
          name: "Line haul",
          lines: [
            {
              kind: "mileage",
              label: "Line haul",
              rateCents: 235,
              quantityThousandths: 412_500,
              unit: "mile",
            },
          ],
          pricing: { mode: "markup", rateBp: 0 },
        },
      }),
    );
    expect(made["costCents"]).toBe(96_938);
    expect((made["lines"] as Json[])[0]).toMatchObject({
      amountCents: 96_938,
      basis: { rateCents: 235, quantityThousandths: 412_500, unit: "mile" },
    });
  });

  it("stores a frozen snapshot that a later read returns unchanged, and never updates it", async () => {
    const w = await workspace();
    const made = await body(
      await api.call("/v1/calculations", {
        ...w.as,
        json: { name: "Snapshot", lines, pricing: { mode: "markup", rateBp: 1_500 } },
      }),
    );
    const read = await body(await api.call(`/v1/calculations/${String(made["id"])}`, w.as));
    expect(read).toEqual(made);
    const stored = await api.ownerRows("SELECT input, result FROM calculation WHERE id = $1", [
      made["id"],
    ]);
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored[0]?.["input"])).toContain("Carrier rate");
  });

  it("rejects invalid money with a clear error", async () => {
    const w = await workspace();
    const post = (json: Json) => api.call("/v1/calculations", { ...w.as, json });
    const base = { name: "x", lines, pricing: { mode: "markup", rateBp: 100 } };
    expect((await post({ ...base, pricing: { mode: "margin", rateBp: 10_000 } })).status).toBe(400);
    expect((await post({ ...base, lines: [] })).status).toBe(400);
    expect(
      (await post({ ...base, lines: [{ kind: "toll", label: "x", amountCents: 1.5 }] })).status,
    ).toBe(400);
    expect(
      (await post({ ...base, lines: [{ kind: "toll", label: "x", amountCents: -1 }] })).status,
    ).toBe(400);
    expect(
      (await post({ ...base, lines: [{ kind: "bribe", label: "x", amountCents: 1 }] })).status,
    ).toBe(400);
    expect((await post({ ...base, pricing: { mode: "magic" } })).status).toBe(400);
    expect(
      (await post({ ...base, customerId: "11111111-1111-4111-8111-111111111111" })).status,
    ).toBe(400);
  });

  it("links a customer of the organization", async () => {
    const w = await workspace();
    const customer = await body(
      await api.call("/v1/customers", { ...w.as, json: { name: "Acme" } }),
    );
    const made = await body(
      await api.call("/v1/calculations", {
        ...w.as,
        json: {
          name: "With customer",
          customerId: customer["id"],
          lines,
          pricing: { mode: "markup", rateBp: 0 },
        },
      }),
    );
    expect(made["customer"]).toEqual({ id: customer["id"], name: "Acme" });
  });
});

describe("listing, permissions and isolation", () => {
  it("lists newest first with paging", async () => {
    const w = await workspace();
    for (const name of ["first", "second", "third"]) {
      await api.call("/v1/calculations", {
        ...w.as,
        json: { name, lines, pricing: { mode: "markup", rateBp: 0 } },
      });
    }
    const page = await body(await api.call("/v1/calculations?limit=2", w.as));
    expect((page["items"] as Json[]).map((item) => item["name"])).toEqual(["third", "second"]);
    expect(page["page"]).toEqual({ limit: 2, offset: 0, total: 3 });
  });

  it.each([
    ["admin", 200, 201],
    ["dispatcher", 200, 201],
    ["sales", 200, 201],
    ["carrier_user", 403, 403],
  ])("%s: read -> %i, create -> %i", async (role, read, create) => {
    const w = await workspace(role);
    expect((await api.call("/v1/calculations", w.as)).status).toBe(read);
    const response = await api.call("/v1/calculations", {
      ...w.as,
      json: { name: "x", lines, pricing: { mode: "markup", rateBp: 0 } },
    });
    expect(response.status).toBe(create);
  });

  it("shows an organization only its own calculations", async () => {
    const a = await workspace();
    const b = await workspace();
    const made = await body(
      await api.call("/v1/calculations", {
        ...a.as,
        json: { name: "Secret lane", lines, pricing: { mode: "markup", rateBp: 0 } },
      }),
    );
    expect(await body(await api.call("/v1/calculations", b.as))).toMatchObject({ items: [] });
    expect((await api.call(`/v1/calculations/${String(made["id"])}`, b.as)).status).toBe(404);
  });

  it("writes an audit entry without the cost lines", async () => {
    const w = await workspace();
    await api.call("/v1/calculations", {
      ...w.as,
      json: { name: "Audited", lines, pricing: { mode: "markup", rateBp: 1_500 } },
    });
    const audit = await body(await api.call("/v1/audit", w.as));
    const entry = (audit["items"] as Json[]).find(
      (item) => item["action"] === "calculation.created",
    );
    expect(entry).toMatchObject({ entityType: "calculation" });
    expect(JSON.stringify(entry)).not.toContain("Carrier rate");
  });
});
