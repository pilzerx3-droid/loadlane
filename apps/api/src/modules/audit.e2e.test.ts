// End-to-end tests of the audit trail view: who may read it, what it shows and tenant isolation.
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

async function admin() {
  const person = await api.person("auditor");
  const organizationId = await api.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles: ["admin"] }],
  });
  return { person, as: { token: person.token, organizationId } };
}

describe("GET /v1/audit", () => {
  it.each([
    ["admin", 200],
    ["dispatcher", 403],
    ["sales", 403],
    ["carrier_user", 403],
  ])("%s -> %i", async (role, expected) => {
    const person = await api.person(role);
    const organizationId = await api.seedOrganization({
      creatorUserId: person.id,
      members: [{ userId: person.id, roles: [role] }],
    });
    const response = await api.call("/v1/audit", { token: person.token, organizationId });
    expect(response.status).toBe(expected);
  });

  it("lists changes newest first with who made them, and never a client address", async () => {
    const { person, as } = await admin();
    await api.call("/v1/customers", { ...as, json: { name: "Acme" } });
    await api.call("/v1/carriers", { ...as, json: { name: "Blue Line" } });

    const page = await body(await api.call("/v1/audit", as));
    const items = page["items"] as Json[];
    expect(items.map((item) => item["action"])).toEqual(["carrier.created", "customer.created"]);
    expect(items[0]).toMatchObject({
      entityType: "carrier",
      actor: { id: person.id },
      changes: { after: { name: "Blue Line" } },
    });
    expect(JSON.stringify(page)).not.toMatch(/"ip"|userAgent|user_agent/);
    expect(page["page"]).toEqual({ limit: 50, offset: 0, total: 2 });
  });

  it("filters by kind of record and by record, and pages", async () => {
    const { as } = await admin();
    const customer = await body(await api.call("/v1/customers", { ...as, json: { name: "Acme" } }));
    await api.call(`/v1/customers/${String(customer["id"])}`, {
      ...as,
      method: "PATCH",
      json: { contactName: "Pat" },
    });
    await api.call("/v1/carriers", { ...as, json: { name: "Blue Line" } });

    const byType = await body(await api.call("/v1/audit?entityType=customer", as));
    expect((byType["items"] as Json[]).map((item) => item["action"])).toEqual([
      "customer.updated",
      "customer.created",
    ]);
    const byId = await body(await api.call(`/v1/audit?entityId=${String(customer["id"])}`, as));
    expect((byId["page"] as Json)["total"]).toBe(2);
    const paged = await body(await api.call("/v1/audit?limit=1&offset=1", as));
    expect((paged["items"] as Json[]).length).toBe(1);
    expect((paged["page"] as Json)["total"]).toBe(3);
  });

  it("rejects an unknown entity type and a malformed id", async () => {
    const { as } = await admin();
    expect((await api.call("/v1/audit?entityType=banana", as)).status).toBe(400);
    expect((await api.call("/v1/audit?entityId=nope", as)).status).toBe(400);
  });

  it("shows an organization only its own entries", async () => {
    const a = await admin();
    const b = await admin();
    await api.call("/v1/customers", { ...a.as, json: { name: "Secret Co" } });
    const page = await body(await api.call("/v1/audit", b.as));
    expect(page["items"]).toEqual([]);
    expect(JSON.stringify(page)).not.toContain("Secret Co");
    const asked = await body(await api.call("/v1/audit?entityType=customer", b.as));
    expect((asked["page"] as Json)["total"]).toBe(0);
  });
});
