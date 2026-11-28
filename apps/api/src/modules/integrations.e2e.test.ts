// End-to-end tests of API keys and the integration API: key handling, scopes, lookups, creating
// transports safely (idempotent by external id), and tenant isolation.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalJson } from "./integrations/integration-service.ts";
import { startTestApi, type TestApi } from "../testing/harness.ts";

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
});

type Json = Record<string, unknown>;
type As = { token: string; organizationId: string };

async function body(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

async function workspace(role = "admin") {
  const person = await api.person("integration");
  const organizationId = await api.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles: [role] }],
  });
  const as: As = { token: person.token, organizationId };
  const customer = await body(await api.call("/v1/customers", { ...as, json: { name: "Acme" } }));
  const location = await body(
    await api.call("/v1/locations", {
      ...as,
      json: {
        name: "Dock",
        addressLine1: "1 Main St",
        city: "Dallas",
        state: "TX",
        postalCode: "75001",
        timezone: "America/Chicago",
      },
    }),
  );
  const key = async (scopes = ["lookup:read", "transport:write"], name = "ERP") =>
    body(await api.call("/v1/api-keys", { ...as, json: { name, scopes } }));
  const payload = (extra: Json = {}) => ({
    customerId: customer["id"],
    weightLb: 12_000,
    stops: [
      {
        type: "pickup",
        locationId: location["id"],
        windowStart: "2030-12-01T14:00:00-06:00",
        windowEnd: "2030-12-01T16:00:00-06:00",
      },
      {
        type: "delivery",
        locationId: location["id"],
        windowStart: "2030-12-02T14:00:00-06:00",
        windowEnd: "2030-12-02T16:00:00-06:00",
      },
    ],
    ...extra,
  });
  return { as, organizationId, customer, location, key, payload, person };
}

function partner(key: string, path: string, json?: unknown) {
  return fetch(`${api.baseUrl}/v1/integration/${path}`, {
    method: json === undefined ? "GET" : "POST",
    headers: { "x-api-key": key, "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
}

describe("canonicalJson", () => {
  it("is the same text for the same content, whatever the key order", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe(
      canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }),
    );
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe(canonicalJson({ b: 1 }));
  });
});

describe("API keys", () => {
  it("creates a key shown once, stores only a hash, lists it without the secret, and revokes it", async () => {
    const w = await workspace();
    const response = await api.call("/v1/api-keys", {
      ...w.as,
      json: { name: "ERP", scopes: ["lookup:read"] },
    });
    expect(response.status).toBe(201);
    const made = await body(response);
    const secret = String(made["key"]);
    expect(secret.startsWith("ll_live_")).toBe(true);
    expect(made).toMatchObject({
      name: "ERP",
      scopes: ["lookup:read"],
      state: "active",
      prefix: secret.slice(0, 12),
      lastUsedAt: null,
    });

    const stored = await api.ownerRows("SELECT * FROM api_key WHERE id = $1", [made["id"]]);
    expect(stored[0]?.["key_hash"]).toBe(createHash("sha256").update(secret).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(JSON.stringify(await body(await api.call("/v1/api-keys", w.as)))).not.toContain(secret);

    const revoked = await body(
      await api.call(`/v1/api-keys/${String(made["id"])}/revoke`, { ...w.as, json: {} }),
    );
    expect(revoked).toMatchObject({ state: "revoked" });
    expect((await partner(secret, "lookups/customers")).status).toBe(401);

    const audit = await body(await api.call("/v1/audit?entityType=api_key", w.as));
    expect((audit["items"] as Json[]).map((item) => item["action"]).sort()).toEqual([
      "api_key.created",
      "api_key.revoked",
    ]);
    expect(JSON.stringify(audit)).not.toContain(secret);
  });

  it("is for administrators only and validates the scopes", async () => {
    const w = await workspace();
    for (const role of ["dispatcher", "sales", "carrier_user"]) {
      const person = await api.person(role);
      await api.asOwner(
        "INSERT INTO membership (organization_id, user_id, status) VALUES ($1, $2, 'active')",
        [w.organizationId, person.id],
      );
      await api.asOwner(
        "INSERT INTO membership_role (organization_id, membership_id, role_key) SELECT organization_id, id, $3 FROM membership WHERE user_id = $1 AND organization_id = $2",
        [person.id, w.organizationId, role],
      );
      const as = { token: person.token, organizationId: w.organizationId };
      expect((await api.call("/v1/api-keys", as)).status, role).toBe(403);
      expect(
        (await api.call("/v1/api-keys", { ...as, json: { name: "x", scopes: ["lookup:read"] } }))
          .status,
        role,
      ).toBe(403);
    }
    expect(
      (await api.call("/v1/api-keys", { ...w.as, json: { name: "x", scopes: [] } })).status,
    ).toBe(400);
    expect(
      (await api.call("/v1/api-keys", { ...w.as, json: { name: "x", scopes: ["admin"] } })).status,
    ).toBe(400);
    expect(
      (await api.call("/v1/api-keys", { ...w.as, json: { name: "", scopes: ["lookup:read"] } }))
        .status,
    ).toBe(400);
  });

  it("keeps keys of one organization invisible and unrevocable for another", async () => {
    const a = await workspace();
    const b = await workspace();
    const made = await a.key();
    expect(((await body(await api.call("/v1/api-keys", b.as)))["items"] as Json[]).length).toBe(0);
    expect(
      (await api.call(`/v1/api-keys/${String(made["id"])}/revoke`, { ...b.as, json: {} })).status,
    ).toBe(404);
  });
});

describe("the integration API", () => {
  it("answers 401 the same way for a missing, malformed, unknown or revoked key", async () => {
    const w = await workspace();
    const made = await w.key();
    await api.call(`/v1/api-keys/${String(made["id"])}/revoke`, { ...w.as, json: {} });
    for (const key of ["", "short", "ll_live_" + "x".repeat(43), String(made["key"])]) {
      const response = await partner(key, "lookups/customers");
      expect(response.status).toBe(401);
      expect((await body(response))["code"]).toBe("invalid_api_key");
    }
    expect((await fetch(`${api.baseUrl}/v1/integration/lookups/customers`)).status).toBe(401);
  });

  it("limits a key to its scopes", async () => {
    const w = await workspace();
    const readOnly = String((await w.key(["lookup:read"]))["key"]);
    const writeOnly = String((await w.key(["transport:write"]))["key"]);
    expect((await partner(readOnly, "lookups/customers")).status).toBe(200);
    expect((await partner(writeOnly, "lookups/customers")).status).toBe(403);
    const attempt = await partner(readOnly, "transports", {
      externalId: "A",
      transport: w.payload(),
    });
    expect(attempt.status).toBe(403);
    expect((await body(attempt))["code"]).toBe("scope_missing");
  });

  it("lists master data ids for the key's own organization, with search and paging", async () => {
    const a = await workspace();
    const b = await workspace();
    for (const name of ["Beta Co", "Gamma Co"])
      await api.call("/v1/customers", { ...a.as, json: { name } });
    await api.call("/v1/customers", { ...b.as, json: { name: "Secret Co" } });
    const key = String((await a.key())["key"]);
    const all = await body(await partner(key, "lookups/customers"));
    expect((all["items"] as Json[]).map((item) => item["name"])).toEqual([
      "Acme",
      "Beta Co",
      "Gamma Co",
    ]);
    expect(JSON.stringify(all)).not.toContain("Secret");
    const found = await body(await partner(key, "lookups/customers?q=gam"));
    expect((found["items"] as Json[]).map((item) => item["name"])).toEqual(["Gamma Co"]);
    const paged = await body(await partner(key, "lookups/customers?limit=1&offset=1"));
    expect(paged["page"]).toEqual({ limit: 1, offset: 1, total: 3 });
    const places = await body(await partner(key, "lookups/locations"));
    expect((places["items"] as Json[])[0]).toMatchObject({
      name: "Dock",
      city: "Dallas",
      state: "TX",
      timezone: "America/Chicago",
    });
    expect((await partner(key, "lookups/vehicles")).status).toBe(400);
    expect((await partner(key, "lookups/customers?limit=5000")).status).toBe(400);
  });

  it("records when a key was last used", async () => {
    const w = await workspace();
    const made = await w.key();
    expect(made["lastUsedAt"]).toBeNull();
    await partner(String(made["key"]), "lookups/carriers");
    const listed = (await body(await api.call("/v1/api-keys", w.as)))["items"] as Json[];
    expect(listed[0]?.["lastUsedAt"]).toBeTruthy();
  });
});

describe("creating transports through the API", () => {
  it("creates the transport, records the integration as its source and keeps the key out of the audit trail", async () => {
    const w = await workspace();
    const made = await w.key();
    const key = String(made["key"]);
    const response = await partner(key, "transports", {
      externalId: "SAP-4711",
      transport: w.payload({ customerReference: "PO-9" }),
    });
    expect(response.status).toBe(200);
    const result = await body(response);
    expect(result["created"]).toBe(true);
    const transport = result["transport"] as Json;
    expect(transport).toMatchObject({ status: "created", customerReference: "PO-9" });
    const events = transport["events"] as Json[];
    expect(events[0]).toMatchObject({ source: "integration", actor: null, toStatus: "created" });

    const list = await body(await api.call("/v1/transports", w.as));
    expect((list["items"] as Json[]).length).toBe(1);
    const audit = await body(await api.call("/v1/audit?entityType=transport", w.as));
    expect((audit["items"] as Json[])[0]).toMatchObject({
      action: "transport.created",
      actor: null,
      changes: { apiKeyId: made["id"] },
    });
    expect(JSON.stringify(audit)).not.toContain(key);
  });

  it("is safe to repeat: the same content returns the same transport, different content is a conflict", async () => {
    const w = await workspace();
    const key = String((await w.key())["key"]);
    const send = (payload: Json, externalId = "SAP-1") =>
      partner(key, "transports", { externalId, transport: payload });
    const first = await body(await send(w.payload()));
    const repeat = await body(await send(w.payload()));
    expect(first["created"]).toBe(true);
    expect(repeat["created"]).toBe(false);
    expect((repeat["transport"] as Json)["id"]).toBe((first["transport"] as Json)["id"]);

    const changed = await send(w.payload({ weightLb: 13_000 }));
    expect(changed.status).toBe(409);
    expect((await body(changed))["code"]).toBe("external_id_conflict");
    const other = await body(await send(w.payload({ weightLb: 13_000 }), "SAP-2"));
    expect(other["created"]).toBe(true);
    const list = await body(await api.call("/v1/transports", w.as));
    expect((list["items"] as Json[]).length).toBe(2);
  });

  it("creates exactly one transport when the same shipment arrives several times at once", async () => {
    const w = await workspace();
    const key = String((await w.key())["key"]);
    const results = await Promise.all(
      [1, 2, 3, 4].map(() =>
        partner(key, "transports", { externalId: "RACE-1", transport: w.payload() }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200]);
    const bodies = await Promise.all(results.map(body));
    expect(bodies.filter((b) => b["created"] === true)).toHaveLength(1);
    const ids = new Set(bodies.map((b) => (b["transport"] as Json)["id"]));
    expect(ids.size).toBe(1);
    expect(((await body(await api.call("/v1/transports", w.as)))["items"] as Json[]).length).toBe(
      1,
    );
  });

  it("refuses invalid input, other organizations' master data and fields partners must not set", async () => {
    const a = await workspace();
    const b = await workspace();
    const key = String((await a.key())["key"]);
    const send = (transport: Json, externalId = "X-1") =>
      partner(key, "transports", { externalId, transport });
    expect((await send(a.payload({ stops: [] }))).status).toBe(400);
    expect(
      (await send(a.payload({ customerId: "11111111-1111-4111-8111-111111111111" }))).status,
    ).toBe(400);
    expect((await send(a.payload({ customerId: b.customer["id"] }), "X-2")).status).toBe(400);
    expect(
      (await send(a.payload({ quoteId: "11111111-1111-4111-8111-111111111111" }), "X-3")).status,
    ).toBe(400);
    expect((await partner(key, "transports", { transport: a.payload() })).status).toBe(400);
    expect(
      (await partner(key, "transports", { externalId: "", transport: a.payload() })).status,
    ).toBe(400);
    expect(((await body(await api.call("/v1/transports", a.as)))["items"] as Json[]).length).toBe(
      0,
    );
  });

  it("never lets one organization's key touch another's transports", async () => {
    const a = await workspace();
    const b = await workspace();
    const keyA = String((await a.key())["key"]);
    const keyB = String((await b.key())["key"]);
    await partner(keyA, "transports", { externalId: "SAME-ID", transport: a.payload() });
    // The same external id in another organization is a different shipment.
    const other = await body(
      await partner(keyB, "transports", { externalId: "SAME-ID", transport: b.payload() }),
    );
    expect(other["created"]).toBe(true);
    expect(((await body(await api.call("/v1/transports", a.as)))["items"] as Json[]).length).toBe(
      1,
    );
    expect(((await body(await api.call("/v1/transports", b.as)))["items"] as Json[]).length).toBe(
      1,
    );
  });
});
