// End-to-end tests of the estimated arrival (ADR 0021) with an in-memory routing provider (MOCK: not
// a real route): when an estimate is made and when it is refused, what it states about itself, the
// refresh limit, the late-arrival alert, and permissions and isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryRoutingProvider } from "../platform/geo-providers.ts";
import { startTestApi, type TestApi } from "../testing/harness.ts";
import { ETA_SERVICE, type EtaService } from "./eta-engine/index.ts";

let api: TestApi;
let plain: TestApi;
const routing = new MemoryRoutingProvider();

beforeAll(async () => {
  api = await startTestApi({ routing });
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

const minutes = (count: number) => new Date(Date.now() + count * 60_000).toISOString();

async function scenario(
  target: TestApi,
  options: { deliveryEndsInMinutes?: number; geocodeDestination?: boolean; role?: string } = {},
) {
  const person = await target.person("eta");
  const organizationId = await target.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles: [options.role ?? "admin"] }],
  });
  const as = { token: person.token, organizationId };
  const post = async (path: string, json: unknown) =>
    body(await target.call(path, { ...as, json }));
  const place = (name: string, city: string) =>
    post("/v1/locations", {
      name,
      addressLine1: `1 ${name} Rd`,
      city,
      state: "TX",
      postalCode: "75001",
      timezone: "America/Chicago",
    });
  const origin = await place("Origin", "Dallas");
  const destination = await place("Destination", "Houston");
  if (options.geocodeDestination !== false) {
    await target.call(`/v1/locations/${String(destination["id"])}/coordinates`, {
      ...as,
      method: "PUT",
      json: { latitude: 29.76, longitude: -95.37 },
    });
  }
  const customer = await post("/v1/customers", { name: "Acme" });
  const carrier = await post("/v1/carriers", { name: "Fast Haul" });
  const stop = (type: string, location: Json, start: string, end: string) => ({
    type,
    locationId: location["id"],
    windowStart: start,
    windowEnd: end,
  });
  const deliveryEnd = minutes(options.deliveryEndsInMinutes ?? 24 * 60);
  const transport = await post("/v1/transports", {
    customerId: customer["id"],
    carrierId: carrier["id"],
    stops: [
      stop("pickup", origin, minutes(-120), minutes(120)),
      stop("delivery", destination, minutes(10), deliveryEnd),
    ],
  });
  const transportId = String(transport["id"]);
  for (const status of ["planned", "assigned", "confirmed"]) {
    await post(`/v1/transports/${transportId}/status`, { status });
  }
  const link = await post(`/v1/transports/${transportId}/driver-links`, {});
  const asDriver = (path: string, json: unknown) =>
    fetch(`${target.baseUrl}/v1/driver/${path}`, {
      method: "POST",
      headers: { "x-driver-token": String(link["token"]), "content-type": "application/json" },
      body: JSON.stringify(json),
    });
  await asDriver("consent", { textVersion: 1 });
  const report = (recordedAt = new Date().toISOString()) =>
    asDriver("position", { latitude: 32.78, longitude: -96.8, accuracyM: 10, recordedAt });
  const eta = async () => body(await target.call(`/v1/transports/${transportId}/eta`, as));
  return { as, organizationId, person, post, transportId, asDriver, report, eta };
}

/** Position intake refreshes the estimate in the background: wait until it shows up. */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let value = await read();
  for (let attempt = 0; attempt < 40 && !done(value); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = await read();
  }
  return value;
}

function service(target: TestApi): EtaService {
  return target.app.get<EtaService>(ETA_SERVICE, { strict: false });
}

describe("estimated arrival from a reported position", () => {
  it("is calculated after a position is stored and states what it is", async () => {
    routing.calls.length = 0;
    routing.result = { distanceMeters: 160_934, durationSeconds: 5_400, geometry: [] };
    const s = await scenario(api);
    expect((await s.eta())["estimate"]).toBeNull();
    const recordedAt = new Date(Date.now() - 60_000).toISOString();
    expect((await s.report(recordedAt)).ok).toBe(true);
    const result = await until(s.eta, (view) => view["estimate"] !== null);
    const estimate = result["estimate"] as Json;
    expect(estimate).toMatchObject({
      distanceMiles: 100,
      drivingMinutes: 90,
      provider: "openrouteservice",
      excludesTrafficAndBreaks: true,
      basedOnPositionAt: recordedAt,
    });
    expect(new Date(String(estimate["estimatedArrival"])).getTime()).toBe(
      new Date(recordedAt).getTime() + 5_400_000,
    );
    expect(result["routingConfigured"]).toBe(true);
    expect(routing.calls).toHaveLength(1);
    expect(routing.calls[0]).toEqual({
      from: { latitude: 32.78, longitude: -96.8 },
      to: { latitude: 29.76, longitude: -95.37 },
    });
  });

  it("is refreshed at most once per interval and never blocks or fails the position", async () => {
    routing.calls.length = 0;
    const s = await scenario(api);
    expect((await s.report()).ok).toBe(true);
    await until(s.eta, (view) => view["estimate"] !== null);
    expect((await s.report(new Date().toISOString())).ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(routing.calls).toHaveLength(1);
    // Direct call: the refresh limit answers with a reason, and a routing failure stores nothing.
    expect(await service(api).refresh(s.organizationId, s.transportId)).toEqual({
      status: "skipped",
      reason: "recent_estimate",
    });
    const later = new Date(Date.now() + 11 * 60_000);
    routing.failWith = "rate_limited";
    try {
      expect(await service(api).refresh(s.organizationId, s.transportId, later)).toEqual({
        status: "failed",
        reason: "rate_limited",
      });
      expect((await s.report()).ok).toBe(true); // a failing provider never fails a position
    } finally {
      routing.failWith = undefined;
    }
  });

  it("is not calculated without a position, a stale position, a destination with coordinates or a route-ready transport", async () => {
    const withoutPosition = await scenario(api);
    expect(
      await service(api).refresh(withoutPosition.organizationId, withoutPosition.transportId),
    ).toEqual({ status: "skipped", reason: "no_position" });

    const noCoordinates = await scenario(api, { geocodeDestination: false });
    await noCoordinates.report();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(
      await service(api).refresh(noCoordinates.organizationId, noCoordinates.transportId),
    ).toEqual({ status: "skipped", reason: "destination_without_coordinates" });
    expect((await noCoordinates.eta())["estimate"]).toBeNull();

    const stale = await scenario(api);
    await stale.report(new Date(Date.now() - 3 * 3_600_000).toISOString());
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await service(api).refresh(stale.organizationId, stale.transportId)).toEqual({
      status: "skipped",
      reason: "position_stale",
    });
    expect((await stale.eta())["estimate"]).toBeNull();

    const finished = await scenario(api);
    await finished.report();
    await finished.post(`/v1/transports/${finished.transportId}/status`, { status: "cancelled" });
    expect(await service(api).refresh(finished.organizationId, finished.transportId)).toEqual({
      status: "skipped",
      reason: "transport_not_en_route",
    });
  });

  it("stops counting an estimate once it is older than half an hour", async () => {
    const s = await scenario(api);
    await s.report();
    await until(s.eta, (view) => view["estimate"] !== null);
    const view = await service(api).get(
      { organizationId: s.organizationId, userId: s.person.id },
      s.transportId,
      new Date(Date.now() + 31 * 60_000),
    );
    expect(view.estimate).toBeNull();
  });
});

describe("late arrival alert", () => {
  it("warns before the window has passed when the estimate is later than its end", async () => {
    routing.result = { distanceMeters: 160_934, durationSeconds: 5_400, geometry: [] }; // 90 minutes
    const late = await scenario(api, { deliveryEndsInMinutes: 30 });
    const onTime = await scenario(api, { deliveryEndsInMinutes: 6 * 60 });
    for (const s of [late, onTime]) {
      await s.report();
      await until(s.eta, (view) => view["estimate"] !== null);
    }
    const lateAlerts = await body(await api.call("/v1/transports/alerts", late.as));
    const items = lateAlerts["items"] as Json[];
    expect(items).toHaveLength(1);
    expect(items[0]?.["conditions"]).toEqual(["eta_late"]);
    expect(items[0]?.["estimatedArrival"]).toEqual(expect.any(String));
    const onTimeAlerts = await body(await api.call("/v1/transports/alerts", onTime.as));
    expect(onTimeAlerts["items"]).toEqual([]);
  });

  it("shows the estimate on the map data", async () => {
    routing.result = { distanceMeters: 80_467, durationSeconds: 3_600, geometry: [] };
    const s = await scenario(api);
    await s.report();
    await until(s.eta, (view) => view["estimate"] !== null);
    const map = await body(await api.call("/v1/map/transports", s.as));
    const item = (map["transports"] as Json[])[0];
    expect(item?.["estimatedArrival"]).toEqual(expect.any(String));
  });
});

describe("access", () => {
  it("answers without an estimate when routing is not configured, 404 across organizations, 403 without permission", async () => {
    const off = await scenario(plain);
    await off.report();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await off.eta()).toEqual({ estimate: null, routingConfigured: false });

    const mine = await scenario(api);
    const foreign = await scenario(api);
    const crossed = await api.call(`/v1/transports/${foreign.transportId}/eta`, mine.as);
    expect(crossed.status).toBe(404);

    const carrierUser = await api.person("carrier-user");
    const org = await api.seedOrganization({
      creatorUserId: carrierUser.id,
      members: [{ userId: carrierUser.id, roles: ["carrier_user"] }],
    });
    const denied = await api.call(`/v1/transports/${mine.transportId}/eta`, {
      token: carrierUser.token,
      organizationId: org,
    });
    expect(denied.status).toBe(403);
  });
});
