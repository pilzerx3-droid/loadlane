// End-to-end tests of location coordinates and the map data (ADR 0021) with an in-memory geocoder
// (MOCK: no real address lookup): storing, refusing weak matches, permissions, isolation, and what the
// map shows (only open transports, only real positions, with their age).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryGeocodingProvider } from "../platform/geo-providers.ts";
import { startTestApi, type TestApi } from "../testing/harness.ts";

let api: TestApi;
let plain: TestApi;
const geocoder = new MemoryGeocodingProvider();

beforeAll(async () => {
  geocoder.set("1 Main St", "Dallas", {
    latitude: 32.776,
    longitude: -96.797,
    label: "1 Main St, Dallas, TX, USA",
  });
  api = await startTestApi({ geocoding: geocoder });
  plain = await startTestApi();
});

afterAll(async () => {
  await api.close();
  await plain.close();
});

type Json = Record<string, unknown>;

async function body(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

async function workspace(target: TestApi, role = "admin") {
  const person = await target.person("maps");
  const organizationId = await target.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles: [role] }],
  });
  const as = { token: person.token, organizationId };
  const post = async (path: string, json: unknown) =>
    body(await target.call(path, { ...as, json }));
  const place = (name: string, addressLine1: string, city: string) =>
    post("/v1/locations", {
      name,
      addressLine1,
      city,
      state: "TX",
      postalCode: "75001",
      timezone: "America/Chicago",
    });
  let customerId: unknown;
  const transport = async (pickup: Json, delivery: Json) => {
    customerId ??= (await post("/v1/customers", { name: "Acme" }))["id"];
    const stop = (type: string, location: Json) => ({
      type,
      locationId: location["id"],
      windowStart: "2030-12-01T14:00:00-06:00",
      windowEnd: "2030-12-01T16:00:00-06:00",
    });
    return body(
      await target.call("/v1/transports", {
        ...as,
        json: {
          customerId,
          stops: [stop("pickup", pickup), stop("delivery", delivery)],
        },
      }),
    );
  };
  return { as, organizationId, person, post, place, transport };
}

describe("geocoding a location", () => {
  it("stores a confident match and returns the label so a wrong match is noticed", async () => {
    const w = await workspace(api);
    const dock = await w.place("Dock 1", "1 Main St", "Dallas");
    expect(dock["latitude"]).toBeNull();
    const response = await api.call(`/v1/locations/${String(dock["id"])}/geocode`, {
      ...w.as,
      json: {},
    });
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({
      locationId: dock["id"],
      latitude: 32.776,
      longitude: -96.797,
      source: "provider",
      matchedLabel: "1 Main St, Dallas, TX, USA",
    });
    const read = await body(await api.call(`/v1/locations/${String(dock["id"])}`, w.as));
    expect(read).toMatchObject({ latitude: 32.776, longitude: -96.797, geocodeSource: "provider" });
    expect(geocoder.queries.at(-1)).toMatchObject({ addressLine1: "1 Main St", city: "Dallas" });
    const audit = await api.ownerRows(
      "SELECT action FROM audit_log WHERE organization_id = $1 AND action = 'location.geocoded'",
      [w.organizationId],
    );
    expect(audit).toHaveLength(1);
  });

  it("stores nothing when the lookup has no confident match", async () => {
    const w = await workspace(api);
    const unknown = await w.place("Nowhere", "9 Unknown Rd", "Nowhere");
    const response = await api.call(`/v1/locations/${String(unknown["id"])}/geocode`, {
      ...w.as,
      json: {},
    });
    expect(response.status).toBe(422);
    expect(await body(response)).toMatchObject({ code: "address_not_found" });
    const read = await body(await api.call(`/v1/locations/${String(unknown["id"])}`, w.as));
    expect(read["latitude"]).toBeNull();
  });

  it("clears coordinates when the address changes, and lets a person enter new ones", async () => {
    const w = await workspace(api);
    const dock = await w.place("Dock 1", "1 Main St", "Dallas");
    const id = String(dock["id"]);
    await api.call(`/v1/locations/${id}/geocode`, { ...w.as, json: {} });
    const moved = await body(
      await api.call(`/v1/locations/${id}`, {
        ...w.as,
        method: "PATCH",
        json: { addressLine1: "500 Other Ave" },
      }),
    );
    expect(moved["latitude"]).toBeNull();
    const manual = await api.call(`/v1/locations/${id}/coordinates`, {
      ...w.as,
      method: "PUT",
      json: { latitude: 32.9, longitude: -96.9 },
    });
    expect(manual.status).toBe(200);
    expect(await body(manual)).toMatchObject({
      source: "manual",
      latitude: 32.9,
      matchedLabel: null,
    });
    const bad = await api.call(`/v1/locations/${id}/coordinates`, {
      ...w.as,
      method: "PUT",
      json: { latitude: 120, longitude: 0 },
    });
    expect(bad.status).toBe(400);
  });

  it("answers 503 without a provider, 404 for another organization's location and 403 without permission", async () => {
    const off = await workspace(plain);
    const dock = await off.place("Dock 1", "1 Main St", "Dallas");
    const unconfigured = await plain.call(`/v1/locations/${String(dock["id"])}/geocode`, {
      ...off.as,
      json: {},
    });
    expect(unconfigured.status).toBe(503);
    expect(await body(unconfigured)).toMatchObject({ code: "geocoding_not_configured" });

    const mine = await workspace(api);
    const foreign = await workspace(api);
    const theirs = await foreign.place("Theirs", "1 Main St", "Dallas");
    expect(
      (await api.call(`/v1/locations/${String(theirs["id"])}/geocode`, { ...mine.as, json: {} }))
        .status,
    ).toBe(404);
    expect(
      (
        await api.call(`/v1/locations/${String(theirs["id"])}/coordinates`, {
          ...mine.as,
          method: "PUT",
          json: { latitude: 1, longitude: 1 },
        })
      ).status,
    ).toBe(404);

    const viewer = await workspace(api, "carrier_user");
    const denied = await api.call(`/v1/locations/${String(theirs["id"])}/geocode`, {
      ...viewer.as,
      json: {},
    });
    expect(denied.status).toBe(403);
  });
});

describe("map data", () => {
  it("lists open transports with stops and coordinates, and says which locations lack them", async () => {
    const w = await workspace(api);
    const dallas = await w.place("Dallas Dock", "1 Main St", "Dallas");
    const houston = await w.place("Houston Dock", "2 Bayou Rd", "Houston");
    await api.call(`/v1/locations/${String(dallas["id"])}/geocode`, { ...w.as, json: {} });
    const transport = await w.transport(dallas, houston);
    const response = await api.call("/v1/map/transports", w.as);
    expect(response.status).toBe(200);
    const map = await body(response);
    const items = map["transports"] as Json[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: transport["id"], status: "created", lastPosition: null });
    const stops = items[0]?.["stops"] as Json[];
    expect(stops.map((stop) => [stop["type"], stop["latitude"]])).toEqual([
      ["pickup", 32.776],
      ["delivery", null],
    ]);
    expect(map["locationsWithoutCoordinates"]).toEqual([
      { id: houston["id"], name: "Houston Dock", city: "Houston", state: "TX" },
    ]);
  });

  it("shows the last position a driver reported with its age, and never invents one", async () => {
    const w = await workspace(api);
    const a = await w.place("A", "1 Main St", "Dallas");
    const b = await w.place("B", "2 Bayou Rd", "Houston");
    const withPosition = await w.transport(a, b);
    const without = await w.transport(a, b);
    // The position comes through the real driver flow: link, consent, then a reading.
    const link = await w.post(`/v1/transports/${String(withPosition["id"])}/driver-links`, {});
    const asDriver = (path: string, json: unknown) =>
      fetch(`${api.baseUrl}/v1/driver/${path}`, {
        method: "POST",
        headers: { "x-driver-token": String(link["token"]), "content-type": "application/json" },
        body: JSON.stringify(json),
      });
    expect((await asDriver("consent", { textVersion: 1 })).ok).toBe(true);
    const recordedAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect(
      (await asDriver("position", { latitude: 31.5, longitude: -97.1, accuracyM: 20, recordedAt }))
        .ok,
    ).toBe(true);
    const map = await body(await api.call("/v1/map/transports", w.as));
    const byId = new Map((map["transports"] as Json[]).map((item) => [item["id"], item]));
    const reported = byId.get(withPosition["id"])?.["lastPosition"] as Json;
    expect(reported).toMatchObject({ latitude: 31.5, longitude: -97.1, freshness: "stale" });
    expect(Number(reported["ageMs"])).toBeGreaterThan(2 * 3_600_000 - 60_000);
    expect(byId.get(without["id"])?.["lastPosition"]).toBeNull();
  });

  it("leaves out finished transports and other organizations, and needs transport:read", async () => {
    const w = await workspace(api);
    const a = await w.place("A", "1 Main St", "Dallas");
    const b = await w.place("B", "2 Bayou Rd", "Houston");
    const open = await w.transport(a, b);
    const cancelled = await w.transport(a, b);
    await w.post(`/v1/transports/${String(cancelled["id"])}/status`, { status: "cancelled" });
    const other = await workspace(api);
    const x = await other.place("X", "1 Main St", "Dallas");
    const y = await other.place("Y", "2 Bayou Rd", "Houston");
    await other.transport(x, y);
    const map = await body(await api.call("/v1/map/transports", w.as));
    expect((map["transports"] as Json[]).map((item) => item["id"])).toEqual([open["id"]]);

    const carrierUser = await api.person("carrier-user");
    const org = await api.seedOrganization({
      creatorUserId: carrierUser.id,
      members: [{ userId: carrierUser.id, roles: ["carrier_user"] }],
    });
    expect(
      (await api.call("/v1/map/transports", { token: carrierUser.token, organizationId: org }))
        .status,
    ).toBe(403);
  });
});
