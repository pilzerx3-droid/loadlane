// End-to-end tests of transports (ADR 0014): creation with stops and numbers, validation, the status
// model with its event history, editing rules, filters and tenant isolation.
import { TRANSPORT_STATUSES } from "@loadlane/shared";
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
  personId: string;
  customerId: string;
  carrierId: string;
  pickupId: string;
  deliveryId: string;
}

/** An organization with an admin, one customer, one carrier and two locations. */
async function workspace(roles: string[] = ["admin"]): Promise<Workspace> {
  const person = await api.person("dispatcher");
  const organizationId = await api.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles }],
  });
  const as = { token: person.token, organizationId };
  // Master data is created by an admin; use the owner connection for roles that may not manage it.
  const admin = roles.includes("admin") ? person : await api.person("admin");
  if (admin !== person) {
    await api.asOwner(
      "INSERT INTO membership (organization_id, user_id, status) VALUES ($1, $2, 'active')",
      [organizationId, admin.id],
    );
    await api.asOwner(
      "INSERT INTO membership_role (organization_id, membership_id, role_key) SELECT organization_id, id, 'admin' FROM membership WHERE user_id = $1 AND organization_id = $2",
      [admin.id, organizationId],
    );
  }
  const asAdmin = { token: admin.token, organizationId };
  const make = async (path: string, json: Json): Promise<string> =>
    String((await body(await api.call(path, { ...asAdmin, json })))["id"]);
  const location = (name: string, city: string, state: string) => ({
    name,
    addressLine1: "1 Main St",
    city,
    state,
    postalCode: "75001",
    timezone: "America/Chicago",
  });
  return {
    as,
    personId: person.id,
    customerId: await make("/v1/customers", { name: "Acme Foods" }),
    carrierId: await make("/v1/carriers", { name: "Blue Line Trucking" }),
    pickupId: await make("/v1/locations", location("Dallas DC", "Dallas", "TX")),
    deliveryId: await make("/v1/locations", location("Austin Store", "Austin", "TX")),
  };
}

function transportInput(w: Workspace, extra: Json = {}): Json {
  return {
    customerId: w.customerId,
    customerReference: "SO-1001",
    stops: [
      {
        type: "pickup",
        locationId: w.pickupId,
        windowStart: "2026-12-01T14:00:00-06:00",
        windowEnd: "2026-12-01T16:00:00-06:00",
      },
      {
        type: "delivery",
        locationId: w.deliveryId,
        windowStart: "2026-12-02T08:00:00-06:00",
        windowEnd: "2026-12-02T12:00:00-06:00",
      },
    ],
    ...extra,
  };
}

async function createTransport(w: Workspace, extra: Json = {}): Promise<Json> {
  const response = await api.call("/v1/transports", { ...w.as, json: transportInput(w, extra) });
  expect(response.status).toBe(201);
  return body(response);
}

async function setStatus(w: Workspace, id: string, status: string, note?: string) {
  return api.call(`/v1/transports/${id}/status`, {
    ...w.as,
    json: note ? { status, note } : { status },
  });
}

describe("permissions", () => {
  const cases: [role: string, read: number, manage: number][] = [
    ["admin", 200, 201],
    ["dispatcher", 200, 201],
    ["sales", 200, 403],
    ["carrier_user", 403, 403],
  ];
  it.each(cases)("%s: list -> %i, create -> %i", async (role, read, manage) => {
    const w = await workspace([role]);
    expect((await api.call("/v1/transports", w.as)).status).toBe(read);
    const created = await api.call("/v1/transports", { ...w.as, json: transportInput(w) });
    expect(created.status).toBe(manage);
  });
});

describe("the status enum", () => {
  it("equals the status model of packages/shared", async () => {
    const result = await api.db.ownerPool.query<{ label: string }>(
      "SELECT enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'transport_status' ORDER BY e.enumsortorder",
    );
    expect(result.rows.map((row) => row.label)).toEqual([...TRANSPORT_STATUSES]);
  });
});

describe("creating a transport", () => {
  it("numbers transports per organization, starts in created and records the first event", async () => {
    const w = await workspace();
    const first = await createTransport(w);
    const second = await createTransport(w);
    expect(first).toMatchObject({ number: 1, reference: "LL-000001", status: "created" });
    expect(second).toMatchObject({ number: 2, reference: "LL-000002" });
    expect(first["allowedStatuses"]).toEqual(["planned", "cancelled"]);
    expect(first["editable"]).toBe(true);
    expect((first["stops"] as Json[]).map((stop) => stop["sequence"])).toEqual([1, 2]);
    expect(first["events"]).toMatchObject([
      { fromStatus: null, toStatus: "created", source: "user" },
    ]);

    const other = await workspace();
    expect(await createTransport(other)).toMatchObject({ number: 1 });
  });

  it("hands out unique numbers to parallel requests", async () => {
    const w = await workspace();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        api.call("/v1/transports", { ...w.as, json: transportInput(w) }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
    const numbers = (await Promise.all(results.map(body))).map((t) => t["number"] as number);
    expect([...numbers].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("stores weight, pieces and references and shows the stops in order with their time zone", async () => {
    const w = await workspace();
    const t = await createTransport(w, { weightLb: 42000.5, pieces: 22, purchaseOrder: "PO-7" });
    expect(t).toMatchObject({
      weightLb: 42000.5,
      pieces: 22,
      purchaseOrder: "PO-7",
      carrier: null,
    });
    const stops = t["stops"] as Json[];
    expect(stops[0]).toMatchObject({ type: "pickup", windowStart: "2026-12-01T20:00:00.000Z" });
    expect((stops[0]?.["location"] as Json)["timezone"]).toBe("America/Chicago");
  });

  it("writes an audit entry", async () => {
    const w = await workspace();
    const t = await createTransport(w);
    const rows = await api.db.ownerPool.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE entity_id = $1",
      [t["id"]],
    );
    expect(rows.rows.map((row) => row.action)).toEqual(["transport.created"]);
  });

  describe("validation", () => {
    const failing: [string, (w: Workspace) => Json, string][] = [
      [
        "a single stop",
        (w) => ({ stops: (transportInput(w)["stops"] as Json[]).slice(0, 1) }),
        "stops",
      ],
      [
        "a first stop that is a delivery",
        (w) => {
          const stops = transportInput(w)["stops"] as Json[];
          return { stops: [{ ...stops[1] }, { ...stops[1] }] };
        },
        "stops.0.type",
      ],
      [
        "a window that ends before it starts",
        (w) => {
          const stops = transportInput(w)["stops"] as Json[];
          return {
            stops: [{ ...stops[0], windowEnd: "2026-12-01T00:00:00Z" }, stops[1]],
          };
        },
        "stops.0.windowEnd",
      ],
      ["a negative weight", () => ({ weightLb: -5 }), "weightLb"],
      ["an unknown field", () => ({ status: "delivered" }), ""],
      [
        "an unknown location",
        (w) => {
          const stops = transportInput(w)["stops"] as Json[];
          return {
            stops: [{ ...stops[0], locationId: "00000000-0000-4000-8000-000000000000" }, stops[1]],
          };
        },
        "stops.0.locationId",
      ],
      [
        "an unknown customer",
        () => ({ customerId: "00000000-0000-4000-8000-000000000000" }),
        "customerId",
      ],
      [
        "an unknown carrier",
        () => ({ carrierId: "00000000-0000-4000-8000-000000000000" }),
        "carrierId",
      ],
    ];
    it.each(failing)("rejects %s", async (_name, change, path) => {
      const w = await workspace();
      const response = await api.call("/v1/transports", {
        ...w.as,
        json: { ...transportInput(w), ...change(w) },
      });
      expect(response.status).toBe(400);
      const problem = await body(response);
      expect(problem["code"]).toBe("validation_failed");
      if (path) {
        expect((problem["errors"] as Json[]).map((error) => error["path"])).toContain(path);
      }
    });

    it("rejects an archived customer", async () => {
      const w = await workspace();
      await api.call(`/v1/customers/${w.customerId}`, {
        ...w.as,
        method: "PATCH",
        json: { archived: true },
      });
      const response = await api.call("/v1/transports", { ...w.as, json: transportInput(w) });
      expect(response.status).toBe(400);
    });
  });
});

describe("status changes", () => {
  it("walks the happy path and keeps every step in the history", async () => {
    const w = await workspace();
    const t = await createTransport(w);
    const id = String(t["id"]);
    expect((await setStatus(w, id, "planned")).status).toBe(200);
    await api.call(`/v1/transports/${id}`, {
      ...w.as,
      method: "PATCH",
      json: { carrierId: w.carrierId },
    });
    for (const status of ["assigned", "confirmed", "in_transit", "delivered", "completed"]) {
      const response = await setStatus(w, id, status);
      expect(response.status, status).toBe(200);
    }
    const detail = await body(await api.call(`/v1/transports/${id}`, w.as));
    expect(detail["status"]).toBe("completed");
    expect(detail["allowedStatuses"]).toEqual([]);
    expect((detail["events"] as Json[]).map((event) => event["toStatus"])).toEqual([
      "completed",
      "delivered",
      "in_transit",
      "confirmed",
      "assigned",
      "planned",
      "created",
    ]);
    expect((detail["events"] as Json[])[0]).toMatchObject({
      source: "user",
      fromStatus: "delivered",
    });
    expect(((detail["events"] as Json[])[0]?.["actor"] as Json)["id"]).toBe(w.personId);
  });

  it("refuses transitions the model does not allow, with a stable code", async () => {
    const w = await workspace();
    const id = String((await createTransport(w))["id"]);
    for (const status of ["assigned", "in_transit", "delivered", "completed", "created"]) {
      const response = await setStatus(w, id, status);
      expect(response.status, status).toBe(409);
      expect(await body(response)).toMatchObject({ code: "invalid_transition" });
    }
    expect(
      ((await body(await api.call(`/v1/transports/${id}`, w.as)))["events"] as Json[]).length,
    ).toBe(1);
  });

  it("needs a carrier before the transport is assigned", async () => {
    const w = await workspace();
    const id = String((await createTransport(w))["id"]);
    await setStatus(w, id, "planned");
    const response = await setStatus(w, id, "assigned");
    expect(response.status).toBe(409);
    expect(await body(response)).toMatchObject({ code: "carrier_required" });
  });

  it("cancels with a note and then allows nothing more", async () => {
    const w = await workspace();
    const id = String((await createTransport(w))["id"]);
    const response = await setStatus(w, id, "cancelled", "Customer withdrew the order");
    expect(response.status).toBe(200);
    const detail = await body(response);
    expect((detail["events"] as Json[])[0]).toMatchObject({
      toStatus: "cancelled",
      note: "Customer withdrew the order",
    });
    expect((await setStatus(w, id, "planned")).status).toBe(409);
  });

  it("rejects a status that does not exist", async () => {
    const w = await workspace();
    const id = String((await createTransport(w))["id"]);
    expect((await setStatus(w, id, "delayed")).status).toBe(400);
  });

  it("changes the status and writes the event in one step: parallel changes cannot both win", async () => {
    const w = await workspace();
    const id = String((await createTransport(w))["id"]);
    const results = await Promise.all([setStatus(w, id, "planned"), setStatus(w, id, "planned")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = await api.db.ownerPool.query(
      "SELECT 1 FROM transport_event WHERE transport_id = $1",
      [id],
    );
    expect(rows.rowCount).toBe(2);
  });

  it("answers 404 for an unknown transport", async () => {
    const w = await workspace();
    expect((await setStatus(w, "00000000-0000-4000-8000-000000000000", "planned")).status).toBe(
      404,
    );
  });
});

describe("editing", () => {
  it("changes fields, replaces stops and leaves other fields alone", async () => {
    const w = await workspace();
    const t = await createTransport(w, { pieces: 10 });
    const id = String(t["id"]);
    const stops = (transportInput(w)["stops"] as Json[]).slice();
    const response = await api.call(`/v1/transports/${id}`, {
      ...w.as,
      method: "PATCH",
      json: {
        customerReference: "SO-2002",
        carrierId: w.carrierId,
        stops: [
          stops[0],
          {
            ...stops[0],
            type: "pickup",
            windowStart: "2026-12-01T17:00:00-06:00",
            windowEnd: "2026-12-01T18:00:00-06:00",
          },
          stops[1],
        ],
      },
    });
    expect(response.status).toBe(200);
    const detail = await body(response);
    expect(detail).toMatchObject({
      customerReference: "SO-2002",
      pieces: 10,
      carrier: { id: w.carrierId },
    });
    expect((detail["stops"] as Json[]).length).toBe(3);
  });

  it("can clear optional fields with null", async () => {
    const w = await workspace();
    const id = String((await createTransport(w, { pieces: 10, carrierId: w.carrierId }))["id"]);
    const detail = await body(
      await api.call(`/v1/transports/${id}`, {
        ...w.as,
        method: "PATCH",
        json: { pieces: null, carrierId: null },
      }),
    );
    expect(detail).toMatchObject({ pieces: null, carrier: null });
  });

  it("refuses to remove the carrier of an assigned transport", async () => {
    const w = await workspace();
    const id = String((await createTransport(w, { carrierId: w.carrierId }))["id"]);
    await setStatus(w, id, "planned");
    await setStatus(w, id, "assigned");
    const response = await api.call(`/v1/transports/${id}`, {
      ...w.as,
      method: "PATCH",
      json: { carrierId: null },
    });
    expect(response.status).toBe(409);
    expect(await body(response)).toMatchObject({ code: "carrier_required" });
  });

  it("refuses edits once the freight is on the road", async () => {
    const w = await workspace();
    const id = String((await createTransport(w, { carrierId: w.carrierId }))["id"]);
    for (const status of ["planned", "assigned", "confirmed", "in_transit"])
      await setStatus(w, id, status);
    const detail = await body(await api.call(`/v1/transports/${id}`, w.as));
    expect(detail["editable"]).toBe(false);
    const response = await api.call(`/v1/transports/${id}`, {
      ...w.as,
      method: "PATCH",
      json: { notes: "late edit" },
    });
    expect(response.status).toBe(409);
    expect(await body(response)).toMatchObject({ code: "transport_not_editable" });
  });
});

describe("list", () => {
  it("filters, searches and pages", async () => {
    const w = await workspace();
    const other = String(
      (await body(await api.call("/v1/customers", { ...w.as, json: { name: "Other Co" } })))["id"],
    );
    const a = await createTransport(w, { customerReference: "ALPHA-1" });
    await createTransport(w, {
      customerId: other,
      customerReference: "BETA-2",
      purchaseOrder: "PO-99",
    });
    await createTransport(w, { customerReference: "GAMMA-3", carrierId: w.carrierId });
    await setStatus(w, String(a["id"]), "planned");

    const list = async (query: string) => body(await api.call(`/v1/transports${query}`, w.as));
    const ids = (page: Json) => (page["items"] as Json[]).map((item) => item["number"]);

    expect(ids(await list(""))).toEqual([3, 2, 1]);
    expect(ids(await list("?status=planned"))).toEqual([1]);
    expect(ids(await list("?status=planned,created"))).toEqual([3, 2, 1]);
    expect(ids(await list(`?customerId=${other}`))).toEqual([2]);
    expect(ids(await list(`?carrierId=${w.carrierId}`))).toEqual([3]);
    expect(ids(await list("?q=beta"))).toEqual([2]);
    expect(ids(await list("?q=po-99"))).toEqual([2]);
    expect(ids(await list("?q=other co"))).toEqual([2]);
    expect(ids(await list("?q=LL-2"))).toEqual([2]);
    expect(ids(await list("?q=blue line"))).toEqual([3]);
    expect(ids(await list("?q=nothing-matches"))).toEqual([]);
    expect(
      ids(await list("?pickupFrom=2026-12-01T00:00:00Z&pickupTo=2026-12-02T00:00:00Z")),
    ).toEqual([3, 2, 1]);
    expect(ids(await list("?pickupFrom=2026-12-03T00:00:00Z"))).toEqual([]);

    const page = await list("?limit=2&offset=1");
    expect(ids(page)).toEqual([2, 1]);
    expect(page["page"]).toEqual({ limit: 2, offset: 1, total: 3 });

    const first = (await list("?limit=1"))["items"] as Json[];
    expect(first[0]).toMatchObject({
      reference: "LL-000003",
      customer: { name: "Acme Foods" },
      carrier: { name: "Blue Line Trucking" },
      origin: { city: "Dallas", state: "TX" },
      destination: { city: "Austin", state: "TX" },
    });
    expect((await api.call("/v1/transports?status=delayed", w.as)).status).toBe(400);
  });

  it("treats % and _ in a search as plain characters", async () => {
    const w = await workspace();
    await createTransport(w);
    const found = await body(await api.call(`/v1/transports?q=${encodeURIComponent("%")}`, w.as));
    expect((found["page"] as Json)["total"]).toBe(0);
  });
});

describe("tenant isolation", () => {
  it("shows organization B nothing of organization A and refuses every write", async () => {
    const a = await workspace();
    const b = await workspace();
    const id = String((await createTransport(a))["id"]);

    expect((await body(await api.call("/v1/transports", b.as)))["items"] as Json[]).toEqual([]);
    expect((await api.call(`/v1/transports/${id}`, b.as)).status).toBe(404);
    expect(
      (await api.call(`/v1/transports/${id}`, { ...b.as, method: "PATCH", json: { notes: "x" } }))
        .status,
    ).toBe(404);
    expect((await setStatus(b, id, "planned")).status).toBe(404);

    const untouched = await body(await api.call(`/v1/transports/${id}`, a.as));
    expect(untouched).toMatchObject({ status: "created", notes: null });
  });

  it("does not accept a customer, carrier or location of another organization", async () => {
    const a = await workspace();
    const b = await workspace();
    for (const change of [
      { customerId: a.customerId },
      { carrierId: a.carrierId },
      {
        stops: [
          { ...(transportInput(b)["stops"] as Json[])[0], locationId: a.pickupId },
          (transportInput(b)["stops"] as Json[])[1],
        ],
      },
    ]) {
      const response = await api.call("/v1/transports", {
        ...b.as,
        json: { ...transportInput(b), ...change },
      });
      expect(response.status).toBe(400);
    }
  });
});

describe("summary", () => {
  const soon = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

  it("counts transports per status and what needs attention, from stored data only", async () => {
    const w = await workspace();
    const empty = await body(await api.call("/v1/transports/summary", w.as));
    expect(empty).toMatchObject({
      total: 0,
      active: 0,
      open: 0,
      withoutCarrier: 0,
      pickupsNext24Hours: 0,
      deliveredLast7Days: 0,
      withoutPosition: 0,
    });
    expect((empty["byStatus"] as Json)["in_transit"]).toBe(0);

    const stops = (start: string, end: string) =>
      (transportInput(w)["stops"] as Json[]).map((stop, index) => ({
        ...stop,
        windowStart: index === 0 ? start : soon(48),
        windowEnd: index === 0 ? end : soon(50),
      }));
    // 1: created, no carrier, pickup in 2 hours
    await createTransport(w, { stops: stops(soon(2), soon(3)) });
    // 2: planned, no carrier, pickup in 3 days
    const planned = String((await createTransport(w, { stops: stops(soon(72), soon(73)) }))["id"]);
    await setStatus(w, planned, "planned");
    // 3: in transit with a carrier
    const moving = String((await createTransport(w, { carrierId: w.carrierId }))["id"]);
    for (const status of ["planned", "assigned", "confirmed", "in_transit"])
      await setStatus(w, moving, status);
    // 4: delivered now
    const delivered = String((await createTransport(w, { carrierId: w.carrierId }))["id"]);
    for (const status of ["planned", "assigned", "confirmed", "in_transit", "delivered"])
      await setStatus(w, delivered, status);
    // 5: cancelled
    const cancelled = String((await createTransport(w))["id"]);
    await setStatus(w, cancelled, "cancelled");

    const summary = await body(await api.call("/v1/transports/summary", w.as));
    expect(summary).toMatchObject({
      total: 5,
      open: 2,
      active: 1,
      withoutCarrier: 2,
      pickupsNext24Hours: 1,
      deliveredLast7Days: 1,
      // The transport on the road has no driver position, and Loadlane does not invent one.
      withoutPosition: 1,
    });
    expect(summary["byStatus"]).toMatchObject({
      created: 1,
      planned: 1,
      in_transit: 1,
      delivered: 1,
      cancelled: 1,
      completed: 0,
    });
  });

  it("does not count delivery events older than seven days", async () => {
    const w = await workspace();
    const id = String((await createTransport(w, { carrierId: w.carrierId }))["id"]);
    for (const status of ["planned", "assigned", "confirmed", "in_transit", "delivered"])
      await setStatus(w, id, status);
    // The history is append-only, so age it through a copy of the row in a transaction-free way: insert an old event for another transport.
    const old = String((await createTransport(w, { carrierId: w.carrierId }))["id"]);
    await api.db.ownerPool.query(
      "ALTER TABLE transport_event DISABLE TRIGGER transport_event_reject_row_change",
    );
    try {
      for (const status of ["planned", "assigned", "confirmed", "in_transit", "delivered"])
        await setStatus(w, old, status);
      await api.db.ownerPool.query(
        "UPDATE transport_event SET occurred_at = now() - interval '10 days' WHERE transport_id = $1 AND to_status = 'delivered'",
        [old],
      );
    } finally {
      await api.db.ownerPool.query(
        "ALTER TABLE transport_event ENABLE TRIGGER transport_event_reject_row_change",
      );
    }
    const summary = await body(await api.call("/v1/transports/summary", w.as));
    expect(summary["deliveredLast7Days"]).toBe(1);
  });

  it("is limited to the caller's organization and to people who may read transports", async () => {
    const a = await workspace();
    const b = await workspace();
    await createTransport(a);
    expect((await body(await api.call("/v1/transports/summary", b.as)))["total"]).toBe(0);
    const carrierUser = await workspace(["carrier_user"]);
    expect((await api.call("/v1/transports/summary", carrierUser.as)).status).toBe(403);
  });
});
