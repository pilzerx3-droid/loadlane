// End-to-end tests of Driver Link management: who may create, the token is shown once and stored
// only as a hash, expiry rules, revocation, audit entries and tenant isolation.
import { createHash } from "node:crypto";
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

interface Workspace {
  as: { token: string; organizationId: string };
  organizationId: string;
  transportId: string;
}

async function workspace(): Promise<Workspace> {
  const person = await api.person("links");
  const organizationId = await api.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles: ["admin"] }],
  });
  const as = { token: person.token, organizationId };
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
  const stop = (type: string) => ({
    type,
    locationId: location["id"],
    windowStart: "2030-12-01T14:00:00-06:00",
    windowEnd: "2030-12-01T16:00:00-06:00",
  });
  const transport = await body(
    await api.call("/v1/transports", {
      ...as,
      json: { customerId: customer["id"], stops: [stop("pickup"), stop("delivery")] },
    }),
  );
  return { as, organizationId, transportId: String(transport["id"]) };
}

async function memberOf(w: Workspace, role: string) {
  const person = await api.person(role);
  await api.asOwner(
    `INSERT INTO membership (organization_id, user_id, status) VALUES ($1, $2, 'active')`,
    [w.organizationId, person.id],
  );
  await api.asOwner(
    `INSERT INTO membership_role (organization_id, membership_id, role_key)
     SELECT $1, id, $3 FROM membership WHERE organization_id = $1 AND user_id = $2`,
    [w.organizationId, person.id, role],
  );
  return { token: person.token, organizationId: w.organizationId };
}

describe("Driver Link management", () => {
  it("creates a link whose token is shown once and stored only as a hash", async () => {
    const w = await workspace();
    const response = await api.call(`/v1/transports/${w.transportId}/driver-links`, {
      ...w.as,
      json: {},
    });
    expect(response.status).toBe(201);
    const created = await body(response);
    const token = String(created["token"]);
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(created).toMatchObject({ state: "active", consent: null, revokedAt: null });
    // Default expiry: 48 hours after the last stop window ends (16:00 CST = 22:00 UTC).
    expect(created["expiresAt"]).toBe("2030-12-03T22:00:00.000Z");

    const stored = await api.ownerRows("SELECT * FROM driver_link WHERE id = $1", [created["id"]]);
    expect(stored[0]?.["token_hash"]).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(token);

    const listed = await body(await api.call(`/v1/transports/${w.transportId}/driver-links`, w.as));
    expect(JSON.stringify(listed)).not.toContain(token);
    expect((listed["items"] as Json[]).map((item) => item["id"])).toEqual([created["id"]]);
  });

  it("honors an explicit lifetime and rejects nonsense", async () => {
    const w = await workspace();
    const url = `/v1/transports/${w.transportId}/driver-links`;
    const short = await body(await api.call(url, { ...w.as, json: { expiresInHours: 2 } }));
    const hours = (Date.parse(String(short["expiresAt"])) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(1.9);
    expect(hours).toBeLessThan(2.1);
    for (const bad of [0, -5, 721, 1.5, "soon"]) {
      expect((await api.call(url, { ...w.as, json: { expiresInHours: bad } })).status).toBe(400);
    }
  });

  it("revokes a link, keeps the first revocation and writes audit entries without the token", async () => {
    const w = await workspace();
    const created = await body(
      await api.call(`/v1/transports/${w.transportId}/driver-links`, { ...w.as, json: {} }),
    );
    const revoke = () =>
      api.call(`/v1/driver-links/${String(created["id"])}/revoke`, { ...w.as, method: "POST" });
    const first = await body(await revoke());
    expect(first["state"]).toBe("revoked");
    const second = await body(await revoke());
    expect(second["revokedAt"]).toBe(first["revokedAt"]);

    const audit = await body(await api.call("/v1/audit", w.as));
    const actions = (audit["items"] as Json[]).map((item) => item["action"]);
    expect(actions.filter((a) => a === "driver_link.revoked")).toHaveLength(1);
    expect(actions).toContain("driver_link.created");
    expect(JSON.stringify(audit)).not.toContain(String(created["token"]));
  });

  it("refuses a link for a cancelled transport", async () => {
    const w = await workspace();
    await api.call(`/v1/transports/${w.transportId}/status`, {
      ...w.as,
      json: { status: "cancelled" },
    });
    const response = await api.call(`/v1/transports/${w.transportId}/driver-links`, {
      ...w.as,
      json: {},
    });
    expect(response.status).toBe(409);
    expect((await body(response))["code"]).toBe("transport_closed");
  });

  it.each([
    ["admin", 201, 200],
    ["dispatcher", 201, 200],
    ["sales", 403, 200],
    ["carrier_user", 403, 403],
  ])("%s: create -> %i, list -> %i", async (role, createStatus, listStatus) => {
    const w = await workspace();
    const as = role === "admin" ? w.as : await memberOf(w, role);
    const url = `/v1/transports/${w.transportId}/driver-links`;
    expect((await api.call(url, { ...as, json: {} })).status).toBe(createStatus);
    expect((await api.call(url, as)).status).toBe(listStatus);
  });

  it("keeps links of one organization invisible and unrevocable for another", async () => {
    const a = await workspace();
    const b = await workspace();
    const created = await body(
      await api.call(`/v1/transports/${a.transportId}/driver-links`, { ...a.as, json: {} }),
    );
    // B asks for A's transport and for A's link.
    expect((await api.call(`/v1/transports/${a.transportId}/driver-links`, b.as)).status).toBe(404);
    expect(
      (
        await api.call(`/v1/transports/${a.transportId}/driver-links`, {
          ...b.as,
          json: {},
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await api.call(`/v1/driver-links/${String(created["id"])}/revoke`, {
          ...b.as,
          method: "POST",
        })
      ).status,
    ).toBe(404);
    const still = await body(await api.call(`/v1/transports/${a.transportId}/driver-links`, a.as));
    expect((still["items"] as Json[])[0]?.["state"]).toBe("active");
  });
});
