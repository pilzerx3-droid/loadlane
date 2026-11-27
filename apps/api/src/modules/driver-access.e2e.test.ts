// End-to-end tests of what a driver can do through a Driver Link: token handling, the consent gate
// for positions, status reports, stale and future readings, closed transports and isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryObjectStorage } from "../platform/object-storage.ts";
import { startTestApi, type TestApi } from "../testing/harness.ts";

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi({ storage: new MemoryObjectStorage() }); // MOCK storage for tests
});

afterAll(async () => {
  await api.close();
});

type Json = Record<string, unknown>;

async function body(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

interface Scenario {
  as: { token: string; organizationId: string };
  transportId: string;
  linkId: string;
  token: string;
}

/** A transport that is confirmed (carrier assigned) with one fresh Driver Link. */
async function scenario(): Promise<Scenario> {
  const person = await api.person("driver-flow");
  const organizationId = await api.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles: ["admin"] }],
  });
  const as = { token: person.token, organizationId };
  const customer = await body(
    await api.call("/v1/customers", { ...as, json: { name: "Secret Customer Inc" } }),
  );
  const carrier = await body(
    await api.call("/v1/carriers", { ...as, json: { name: "Blue Line" } }),
  );
  const location = await body(
    await api.call("/v1/locations", {
      ...as,
      json: {
        name: "Dock 4",
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
      json: {
        customerId: customer["id"],
        carrierId: carrier["id"],
        stops: [stop("pickup"), stop("delivery")],
      },
    }),
  );
  const transportId = String(transport["id"]);
  for (const status of ["planned", "assigned", "confirmed"]) {
    await api.call(`/v1/transports/${transportId}/status`, { ...as, json: { status } });
  }
  const link = await body(
    await api.call(`/v1/transports/${transportId}/driver-links`, { ...as, json: {} }),
  );
  return { as, transportId, linkId: String(link["id"]), token: String(link["token"]) };
}

function driver(token: string, path: string, json?: unknown) {
  return fetch(`${api.baseUrl}/v1/driver/${path}`, {
    method: json === undefined ? "GET" : "POST",
    headers: { "x-driver-token": token, "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
}

const agree = { textVersion: 1 };
const reading = (overrides: Json = {}) => ({
  latitude: 32.78,
  longitude: -96.8,
  accuracyM: 8,
  recordedAt: new Date().toISOString(),
  ...overrides,
});

describe("Driver Link access", () => {
  it("answers an unknown or missing token the same way and reveals nothing", async () => {
    for (const token of ["", "short", "x".repeat(60)]) {
      const response = await driver(token, "job");
      expect(response.status).toBe(404);
      expect((await body(response))["code"]).toBe("driver_link_invalid");
    }
    const noHeader = await fetch(`${api.baseUrl}/v1/driver/job`);
    expect(noHeader.status).toBe(404);
  });

  it("shows the job without customer or price information", async () => {
    const s = await scenario();
    const response = await driver(s.token, "job");
    expect(response.status).toBe(200);
    const job = await body(response);
    expect(job).toMatchObject({
      reference: expect.stringMatching(/^LL-\d{6}$/) as unknown,
      status: "confirmed",
      sharing: false,
      consent: null,
      // Loading is an optional step, so a driver may go straight to "on the road".
      nextStatuses: ["loading", "in_transit"],
    });
    expect((job["stops"] as Json[]).map((stop) => stop["type"])).toEqual(["pickup", "delivery"]);
    expect(JSON.stringify(job)).not.toContain("Secret Customer");
  });

  it("refuses positions until the driver agreed, then stores them", async () => {
    const s = await scenario();
    const before = await driver(s.token, "position", reading());
    expect(before.status).toBe(403);
    expect((await body(before))["code"]).toBe("consent_required");
    expect(
      await api.ownerRows("SELECT 1 FROM position_event WHERE transport_id = $1", [s.transportId]),
    ).toHaveLength(0);

    const consent = await driver(s.token, "consent", agree);
    expect(consent.status).toBe(200);
    expect(await body(consent)).toMatchObject({ sharing: true });

    const sent = await driver(s.token, "position", reading());
    expect(sent.status).toBe(201);
    const events = await api.ownerRows(
      "SELECT driver_link_id, low_quality, accuracy_m FROM position_event WHERE transport_id = $1",
      [s.transportId],
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ driver_link_id: s.linkId, low_quality: false });
    const last = await api.ownerRows("SELECT latitude FROM last_position WHERE transport_id = $1", [
      s.transportId,
    ]);
    expect(last).toHaveLength(1);
  });

  it("shows the last position to dispatchers and counts transports on the road without one", async () => {
    const s = await scenario();
    await driver(s.token, "consent", agree);
    await driver(s.token, "status", { status: "in_transit" });

    const before = await body(await api.call(`/v1/transports/${s.transportId}`, s.as));
    expect(before["lastPosition"]).toBeNull();
    const countBefore = await body(await api.call("/v1/transports/summary", s.as));
    expect(countBefore["withoutPosition"]).toBe(1);

    const recordedAt = new Date(Date.now() - 90_000).toISOString();
    await driver(s.token, "position", reading({ latitude: 33.1, longitude: -97.2, recordedAt }));
    const after = await body(await api.call(`/v1/transports/${s.transportId}`, s.as));
    expect(after["lastPosition"]).toMatchObject({
      latitude: 33.1,
      longitude: -97.2,
      lowQuality: false,
      recordedAt,
    });
    const countAfter = await body(await api.call("/v1/transports/summary", s.as));
    expect(countAfter["withoutPosition"]).toBe(0);
  });

  it("keeps repeating consent harmless and lets the driver stop sharing", async () => {
    const s = await scenario();
    await driver(s.token, "consent", agree);
    await driver(s.token, "consent", agree);
    expect(
      await api.ownerRows("SELECT 1 FROM driver_consent WHERE driver_link_id = $1", [s.linkId]),
    ).toHaveLength(1);

    const stopped = await body(await driver(s.token, "consent/withdraw", {}));
    expect(stopped["sharing"]).toBe(false);
    expect((stopped["consent"] as Json)["withdrawnAt"]).toBeTruthy();
    expect((await driver(s.token, "position", reading())).status).toBe(403);

    // The driver can agree again later.
    expect((await body(await driver(s.token, "consent", agree)))["sharing"]).toBe(true);
    expect((await driver(s.token, "position", reading())).status).toBe(201);
  });

  it("rejects an outdated consent text and nonsense readings", async () => {
    const s = await scenario();
    expect((await driver(s.token, "consent", { textVersion: 0 })).status).toBe(400);
    await driver(s.token, "consent", agree);
    const bad = [
      reading({ latitude: 91 }),
      reading({ longitude: 200 }),
      reading({ accuracyM: -3 }),
      reading({ recordedAt: new Date(Date.now() + 3_600_000).toISOString() }),
      reading({ recordedAt: "yesterday" }),
      { latitude: 1 },
    ];
    for (const json of bad) {
      expect((await driver(s.token, "position", json)).status).toBe(400);
    }
    expect(
      await api.ownerRows("SELECT 1 FROM position_event WHERE transport_id = $1", [s.transportId]),
    ).toHaveLength(0);
  });

  it("flags coarse readings and never lets an older reading replace a newer one", async () => {
    const s = await scenario();
    await driver(s.token, "consent", agree);
    const newer = new Date(Date.now() - 60_000).toISOString();
    const older = new Date(Date.now() - 600_000).toISOString();
    await driver(s.token, "position", reading({ latitude: 40, recordedAt: newer }));
    await driver(
      s.token,
      "position",
      reading({ latitude: 10, recordedAt: older, accuracyM: 9000 }),
    );
    const last = await api.ownerRows("SELECT latitude FROM last_position WHERE transport_id = $1", [
      s.transportId,
    ]);
    expect(last[0]?.["latitude"]).toBe(40);
    const events = await api.ownerRows(
      "SELECT latitude, low_quality FROM position_event WHERE transport_id = $1 ORDER BY latitude",
      [s.transportId],
    );
    expect(events.map((event) => event["low_quality"])).toEqual([true, false]);
  });

  it("reports statuses by the transition rules and records the driver as the source", async () => {
    const s = await scenario();
    expect((await driver(s.token, "status", { status: "delivered" })).status).toBe(409);
    expect((await driver(s.token, "status", { status: "planned" })).status).toBe(400);
    const moved = await driver(s.token, "status", { status: "loading", note: "At the dock" });
    expect(moved.status).toBe(200);
    expect(await body(moved)).toMatchObject({ status: "loading", nextStatuses: ["in_transit"] });

    const events = await api.ownerRows(
      "SELECT source, actor_user_id, to_status, note FROM transport_event WHERE transport_id = $1 AND source = 'driver'",
      [s.transportId],
    );
    expect(events).toEqual([
      { source: "driver", actor_user_id: null, to_status: "loading", note: "At the dock" },
    ]);
    const detail = await body(await api.call(`/v1/transports/${s.transportId}`, s.as));
    expect(detail["status"]).toBe("loading");
  });

  it("stops accepting positions when the transport is delivered", async () => {
    const s = await scenario();
    await driver(s.token, "consent", agree);
    for (const status of ["loading", "in_transit", "at_destination", "unloading", "delivered"]) {
      expect((await driver(s.token, "status", { status })).status).toBe(200);
    }
    const response = await driver(s.token, "position", reading());
    expect(response.status).toBe(409);
    expect((await body(response))["code"]).toBe("tracking_closed");
    const job = await body(await driver(s.token, "job"));
    expect(job).toMatchObject({ sharing: false, nextStatuses: [] });
  });

  it("lets the driver upload a photo that dispatchers then see, checked by content", async () => {
    const s = await scenario();
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("proof of delivery photo"),
    ]);
    const send = (bytes: Buffer, name: string, type = "proof_of_delivery", token = s.token) => {
      const form = new FormData();
      form.set("type", type);
      form.set("file", new Blob([new Uint8Array(bytes)]), name);
      return fetch(`${api.baseUrl}/v1/driver/documents`, {
        method: "POST",
        headers: { "x-driver-token": token },
        body: form,
      });
    };

    const ok = await send(png, "pod.png");
    expect(ok.status).toBe(201);
    expect((await send(Buffer.from("just text"), "note.txt")).status).toBe(400);
    expect((await send(png, "x.png", "invoice")).status).toBe(400);
    expect((await send(png, "x.png", "photo", "x".repeat(60))).status).toBe(404);

    const listed = await body(await api.call(`/v1/transports/${s.transportId}/documents`, s.as));
    const items = listed["items"] as Json[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      filename: "pod.png",
      contentType: "image/png",
      uploadedBy: null,
      uploadedByDriver: true,
    });
    const stored = await api.ownerRows(
      "SELECT uploaded_by_user_id, uploaded_by_driver_link_id FROM document WHERE transport_id = $1",
      [s.transportId],
    );
    expect(stored).toEqual([{ uploaded_by_user_id: null, uploaded_by_driver_link_id: s.linkId }]);
    const audit = await body(await api.call("/v1/audit?entityType=document", s.as));
    expect((audit["items"] as Json[]).map((item) => item["action"])).toEqual(["document.uploaded"]);

    await api.call(`/v1/driver-links/${s.linkId}/revoke`, { ...s.as, method: "POST" });
    expect((await send(png, "again.png")).status).toBe(410);
  });

  it("answers 410 for revoked and expired links", async () => {
    const s = await scenario();
    await api.call(`/v1/driver-links/${s.linkId}/revoke`, { ...s.as, method: "POST" });
    for (const [path, json] of [
      ["job", undefined],
      ["consent", agree],
      ["position", reading()],
      ["status", { status: "loading" }],
    ] as const) {
      const response = await driver(s.token, path, json);
      expect(response.status).toBe(410);
      expect((await body(response))["code"]).toBe("driver_link_revoked");
    }

    const e = await scenario();
    await api.asOwner(
      "UPDATE driver_link SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [e.linkId],
    );
    const response = await driver(e.token, "job");
    expect(response.status).toBe(410);
    expect((await body(response))["code"]).toBe("driver_link_expired");
  });

  it("keeps each link to its own transport and organization, and the token out of the audit trail", async () => {
    const a = await scenario();
    const b = await scenario();
    const jobA = await body(await driver(a.token, "job"));
    const jobB = await body(await driver(b.token, "job"));
    expect(jobA["reference"]).toBe("LL-000001");
    expect(jobB["reference"]).toBe("LL-000001");
    await driver(a.token, "consent", agree);
    await driver(a.token, "position", reading());
    expect(
      await api.ownerRows("SELECT 1 FROM position_event WHERE organization_id = $1", [
        b.as.organizationId,
      ]),
    ).toHaveLength(0);

    const audit = await body(await api.call("/v1/audit", a.as));
    const actions = (audit["items"] as Json[]).map((item) => item["action"]);
    expect(actions).toContain("driver.consent_given");
    expect(JSON.stringify(audit)).not.toContain(a.token);
  });
});
