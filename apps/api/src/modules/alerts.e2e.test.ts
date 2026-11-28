// End-to-end tests of the alert list: conditions come only from planned windows and received
// positions, finished transports never appear, and organizations see only their own.
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
  const person = await api.person("alerts");
  const organizationId = await api.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles: ["admin"] }],
  });
  const as = { token: person.token, organizationId };
  const customer = await body(await api.call("/v1/customers", { ...as, json: { name: "Acme" } }));
  const carrier = await body(
    await api.call("/v1/carriers", { ...as, json: { name: "Blue Line" } }),
  );
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
  const create = async (windowStart: string, windowEnd: string) => {
    const stop = (type: string) => ({ type, locationId: location["id"], windowStart, windowEnd });
    const made = await body(
      await api.call("/v1/transports", {
        ...as,
        json: {
          customerId: customer["id"],
          carrierId: carrier["id"],
          stops: [stop("pickup"), stop("delivery")],
        },
      }),
    );
    return String(made["id"]);
  };
  return { as, organizationId, create };
}

async function alerts(as: { token: string; organizationId: string }) {
  const response = await api.call("/v1/transports/alerts", as);
  expect(response.status).toBe(200);
  return (await body(response))["items"] as Json[];
}

describe("GET /v1/transports/alerts", () => {
  it("lists overdue transports and leaves out those on plan or finished", async () => {
    const w = await workspace();
    const late = await w.create("2020-01-01T10:00:00-06:00", "2020-01-01T12:00:00-06:00");
    await w.create("2099-01-01T10:00:00-06:00", "2099-01-01T12:00:00-06:00");
    const done = await w.create("2020-01-01T10:00:00-06:00", "2020-01-01T12:00:00-06:00");
    for (const status of ["planned", "assigned", "confirmed", "in_transit", "delivered"]) {
      await api.call(`/v1/transports/${done}/status`, { ...w.as, json: { status } });
    }

    const items = await alerts(w.as);
    expect(items.map((item) => item["id"])).toEqual([late]);
    expect(items[0]?.["conditions"]).toEqual(["overdue_pickup", "overdue_delivery"]);
    expect(items[0]).toMatchObject({ customerName: "Acme", carrierName: "Blue Line" });
  });

  it("flags a transport on the road without a position, and no estimate appears", async () => {
    const w = await workspace();
    const id = await w.create("2099-01-01T10:00:00-06:00", "2099-01-02T12:00:00-06:00");
    for (const status of ["planned", "assigned", "confirmed", "in_transit"]) {
      await api.call(`/v1/transports/${id}/status`, { ...w.as, json: { status } });
    }
    const items = await alerts(w.as);
    expect(items).toHaveLength(1);
    expect(items[0]?.["conditions"]).toEqual(["no_position"]);
    expect(JSON.stringify(items)).not.toMatch(/eta/i);
  });

  it("is limited to the caller's organization and to people who may read transports", async () => {
    const a = await workspace();
    const b = await workspace();
    await a.create("2020-01-01T10:00:00-06:00", "2020-01-01T12:00:00-06:00");
    expect(await alerts(b.as)).toEqual([]);

    const outsider = await api.person("carrier_user");
    await api.asOwner(
      "INSERT INTO membership (organization_id, user_id, status) VALUES ($1, $2, 'active')",
      [a.organizationId, outsider.id],
    );
    await api.asOwner(
      "INSERT INTO membership_role (organization_id, membership_id, role_key) SELECT organization_id, id, 'carrier_user' FROM membership WHERE user_id = $1 AND organization_id = $2",
      [outsider.id, a.organizationId],
    );
    const denied = await api.call("/v1/transports/alerts", {
      token: outsider.token,
      organizationId: a.organizationId,
    });
    expect(denied.status).toBe(403);
  });
});
