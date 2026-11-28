// End-to-end tests of customer tracking links: who may manage them, what the public view contains
// (and what it never contains), revocation, expiry and tenant isolation.
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

async function workspace() {
  const person = await api.person("tracking");
  const organizationId = await api.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles: ["admin"] }],
  });
  const as = { token: person.token, organizationId };
  const customer = await body(
    await api.call("/v1/customers", { ...as, json: { name: "Secret Customer Inc" } }),
  );
  const carrier = await body(
    await api.call("/v1/carriers", { ...as, json: { name: "Hidden Carrier" } }),
  );
  const location = await body(
    await api.call("/v1/locations", {
      ...as,
      json: {
        name: "Dock 4",
        addressLine1: "1 Private Rd",
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
      json: {
        customerId: customer["id"],
        carrierId: carrier["id"],
        customerReference: "PO-4711",
        notes: "internal note",
        stops: [stop("pickup"), stop("delivery")],
      },
    }),
  );
  const transportId = String(transport["id"]);
  const create = async (json: Json = {}) =>
    api.call(`/v1/transports/${transportId}/tracking-links`, { ...as, json });
  return { as, organizationId, transportId, create };
}

function view(token: string) {
  return fetch(`${api.baseUrl}/v1/tracking/view`, { headers: { "x-tracking-token": token } });
}

describe("customer tracking links", () => {
  it("gives the customer status, windows and history, and nothing internal", async () => {
    const w = await workspace();
    await api.call(`/v1/transports/${w.transportId}/status`, {
      ...w.as,
      json: { status: "planned", note: "secret dispatcher note" },
    });
    const created = await body(await w.create());
    const response = await view(String(created["token"]));
    expect(response.status).toBe(200);
    const page = await body(response);
    expect(page).toMatchObject({ customerReference: "PO-4711", status: "planned" });
    expect((page["stops"] as Json[])[0]).toMatchObject({
      type: "pickup",
      placeName: "Dock 4",
      city: "Dallas",
      timezone: "America/Chicago",
    });
    expect((page["history"] as Json[]).map((entry) => entry["status"])).toEqual([
      "created",
      "planned",
    ]);
    const text = JSON.stringify(page);
    for (const secret of [
      "Secret Customer",
      "Hidden Carrier",
      "internal note",
      "secret dispatcher",
      "1 Private Rd",
      "latitude",
      "actor",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("never shows a driver position, even when one was shared", async () => {
    const w = await workspace();
    await api.asOwner(
      "INSERT INTO last_position (organization_id, transport_id, recorded_at, received_at, latitude, longitude) VALUES ($1, $2, now(), now(), 32.1, -96.1)",
      [w.organizationId, w.transportId],
    );
    const created = await body(await w.create());
    const page = JSON.stringify(await body(await view(String(created["token"]))));
    expect(page).not.toContain("32.1");
    expect(page).not.toContain("position");
  });

  it("stores only a hash and shows the token once", async () => {
    const w = await workspace();
    const created = await body(await w.create({ expiresInDays: 5 }));
    const token = String(created["token"]);
    const stored = await api.ownerRows("SELECT * FROM tracking_link WHERE id = $1", [
      created["id"],
    ]);
    expect(JSON.stringify(stored)).not.toContain(token);
    const listed = await body(
      await api.call(`/v1/transports/${w.transportId}/tracking-links`, w.as),
    );
    expect(JSON.stringify(listed)).not.toContain(token);
    const days = (Date.parse(String(created["expiresAt"])) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(4.9);
    expect(days).toBeLessThan(5.1);
  });

  it("answers 404 for unknown tokens and 410 for revoked or expired links", async () => {
    const w = await workspace();
    for (const token of ["", "short", "x".repeat(60)]) {
      expect((await view(token)).status).toBe(404);
    }
    const revoked = await body(await w.create());
    await api.call(`/v1/tracking-links/${String(revoked["id"])}/revoke`, {
      ...w.as,
      method: "POST",
    });
    const gone = await view(String(revoked["token"]));
    expect(gone.status).toBe(410);
    expect((await body(gone))["code"]).toBe("tracking_link_revoked");

    const expired = await body(await w.create());
    await api.asOwner(
      "UPDATE tracking_link SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [expired["id"]],
    );
    const old = await view(String(expired["token"]));
    expect(old.status).toBe(410);
    expect((await body(old))["code"]).toBe("tracking_link_expired");
  });

  it("rejects bad lifetimes and links for cancelled transports", async () => {
    const w = await workspace();
    for (const bad of [0, 91, 1.5, "soon"]) {
      expect((await w.create({ expiresInDays: bad })).status).toBe(400);
    }
    await api.call(`/v1/transports/${w.transportId}/status`, {
      ...w.as,
      json: { status: "cancelled" },
    });
    expect((await w.create()).status).toBe(409);
  });

  it("limits management by permission and organization, and writes audit entries", async () => {
    const a = await workspace();
    const b = await workspace();
    const created = await body(await a.create());
    expect((await api.call(`/v1/transports/${a.transportId}/tracking-links`, b.as)).status).toBe(
      404,
    );
    expect(
      (
        await api.call(`/v1/tracking-links/${String(created["id"])}/revoke`, {
          ...b.as,
          method: "POST",
        })
      ).status,
    ).toBe(404);

    const sales = await api.person("sales");
    await api.asOwner(
      "INSERT INTO membership (organization_id, user_id, status) VALUES ($1, $2, 'active')",
      [a.organizationId, sales.id],
    );
    await api.asOwner(
      "INSERT INTO membership_role (organization_id, membership_id, role_key) SELECT organization_id, id, 'sales' FROM membership WHERE user_id = $1 AND organization_id = $2",
      [sales.id, a.organizationId],
    );
    const asSales = { token: sales.token, organizationId: a.organizationId };
    expect((await api.call(`/v1/transports/${a.transportId}/tracking-links`, asSales)).status).toBe(
      200,
    );
    expect(
      (
        await api.call(`/v1/transports/${a.transportId}/tracking-links`, {
          ...asSales,
          json: {},
        })
      ).status,
    ).toBe(403);

    const audit = await body(await api.call("/v1/audit?entityType=tracking_link", a.as));
    expect(JSON.stringify(audit)).not.toContain(String(created["token"]));
    expect((audit["items"] as Json[]).map((item) => item["action"])).toEqual([
      "tracking_link.created",
    ]);
  });
});
