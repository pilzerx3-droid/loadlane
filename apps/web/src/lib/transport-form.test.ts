import { describe, expect, it, vi } from "vitest";
import { makeDeps } from "../testing/helpers";
import { changeTransportStatus, saveTransport } from "./transport-actions";
import {
  buildTransportInput,
  emptyTransportForm,
  formFieldFor,
  parseTransportForm,
  type TransportFormValues,
} from "./transport-form";

const ORG = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const DALLAS = "33333333-3333-4333-8333-333333333333";
const DENVER = "44444444-4444-4444-8444-444444444444";
const ID = "55555555-5555-4555-8555-555555555555";

const zones = { [DALLAS]: "America/Chicago", [DENVER]: "America/Denver" };

function filled(): TransportFormValues {
  return {
    ...emptyTransportForm(),
    customerId: CUSTOMER,
    stops: [
      {
        type: "pickup",
        locationId: DALLAS,
        start: "2026-12-01T14:00",
        end: "2026-12-01T16:00",
        reference: "",
      },
      {
        type: "delivery",
        locationId: DENVER,
        start: "2026-12-02T08:00",
        end: "2026-12-02T12:00",
        reference: "A-1",
      },
    ],
  };
}

describe("parseTransportForm", () => {
  it("reads the fields and the stop rows in order, and trims", () => {
    const form = new FormData();
    form.set("customerId", ` ${CUSTOMER} `);
    form.set("weightLb", "42,000");
    form.set("stops.0.type", "pickup");
    form.set("stops.0.locationId", DALLAS);
    form.set("stops.0.start", "2026-12-01T14:00");
    form.set("stops.1.type", "delivery");
    form.set("stops.1.locationId", DENVER);
    form.set("stops.1.reference", " A-1 ");
    const values = parseTransportForm(form);
    expect(values.customerId).toBe(CUSTOMER);
    expect(values.weightLb).toBe("42,000");
    expect(values.stops.map((stop) => [stop.type, stop.locationId])).toEqual([
      ["pickup", DALLAS],
      ["delivery", DENVER],
    ]);
    expect(values.stops[1]?.reference).toBe("A-1");
  });

  it("stops at the first missing row and at the limit, and ignores unknown types", () => {
    const form = new FormData();
    form.set("stops.0.locationId", DALLAS);
    form.set("stops.0.type", "teleport");
    form.set("stops.2.locationId", DENVER);
    const values = parseTransportForm(form);
    expect(values.stops).toHaveLength(1);
    expect(values.stops[0]?.type).toBe("pickup");

    const many = new FormData();
    for (let index = 0; index < 40; index++) many.set(`stops.${index}.locationId`, DALLAS);
    expect(parseTransportForm(many).stops).toHaveLength(20);
  });
});

describe("buildTransportInput", () => {
  it("reads each stop's times in the time zone of its location", () => {
    const { input, errors } = buildTransportInput(filled(), zones);
    expect(errors).toEqual({});
    const stops = input["stops"] as { windowStart: string; windowEnd: string }[];
    expect(stops[0]).toMatchObject({
      windowStart: "2026-12-01T20:00:00.000Z",
      windowEnd: "2026-12-01T22:00:00.000Z",
    });
    expect(stops[1]).toMatchObject({ windowStart: "2026-12-02T15:00:00.000Z" });
    expect(input).toMatchObject({
      customerId: CUSTOMER,
      carrierId: null,
      weightLb: null,
      pieces: null,
    });
  });

  it("parses weight and pieces", () => {
    const { input, errors } = buildTransportInput(
      { ...filled(), weightLb: "42,000.5", pieces: "22" },
      zones,
    );
    expect(errors).toEqual({});
    expect(input).toMatchObject({ weightLb: 42000.5, pieces: 22 });
  });

  it.each([
    ["weightLb", { weightLb: "heavy" }],
    ["weightLb", { weightLb: "0" }],
    ["pieces", { pieces: "1.5" }],
    ["pieces", { pieces: "-2" }],
    ["customerId", { customerId: "" }],
  ])("reports %s", (field, change) => {
    const { errors } = buildTransportInput({ ...filled(), ...change }, zones);
    expect(errors[field]).toBeTruthy();
  });

  it("reports missing locations, unreadable times and windows that end early, by stop", () => {
    const values = filled();
    values.stops[0] = { ...values.stops[0]!, locationId: "" };
    values.stops[1] = { ...values.stops[1]!, start: "", end: "2026-12-01T00:00" };
    const { errors } = buildTransportInput(values, zones);
    expect(errors["stops.0.locationId"]).toBeTruthy();
    expect(errors["stops.1.start"]).toBeTruthy();
    expect(errors["stops.1.end"]).toBeUndefined();

    const early = filled();
    early.stops[0] = { ...early.stops[0]!, end: "2026-12-01T10:00" };
    expect(buildTransportInput(early, zones).errors["stops.0.end"]).toMatch(/cannot end before/);
  });

  it("asks for at least two stops", () => {
    const { errors } = buildTransportInput({ ...filled(), stops: [] }, zones);
    expect(errors["stops"]).toBeTruthy();
  });

  it("does not trust a location it has no time zone for", () => {
    const { errors } = buildTransportInput(filled(), { [DALLAS]: "America/Chicago" });
    expect(errors["stops.1.locationId"]).toBeTruthy();
  });
});

describe("formFieldFor", () => {
  it("maps API paths of stop windows to form fields", () => {
    expect(formFieldFor("stops.0.windowStart")).toBe("stops.0.start");
    expect(formFieldFor("stops.3.windowEnd")).toBe("stops.3.end");
    expect(formFieldFor("customerId")).toBe("customerId");
    expect(formFieldFor("stops.1.locationId")).toBe("stops.1.locationId");
  });
});

function sequence(...responses: [number, unknown][]): typeof fetch {
  const queue = [...responses];
  return vi.fn(() => {
    const [status, body] = queue.shift() ?? [500, {}];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
}

async function sessionFor(deps: ReturnType<typeof makeDeps>) {
  return deps.store.createSession(
    {
      accessToken: "access-1",
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
      subject: "s",
      activeOrganizationId: ORG,
    },
    60,
  );
}

describe("saveTransport", () => {
  it("looks up the time zones, converts the times and creates the transport", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = sequence(
      [200, { id: DALLAS, timezone: "America/Chicago" }],
      [200, { id: DENVER, timezone: "America/Denver" }],
      [201, { id: ID }],
    );
    expect(await saveTransport(sessionId, undefined, filled(), deps, fetchFn)).toEqual({
      status: "saved",
      id: ID,
    });
    const calls = vi.mocked(fetchFn).mock.calls;
    expect(calls.map(([url]) => url)).toEqual([
      `http://127.0.0.1:4000/v1/locations/${DALLAS}`,
      `http://127.0.0.1:4000/v1/locations/${DENVER}`,
      "http://127.0.0.1:4000/v1/transports",
    ]);
    const body = JSON.parse(calls[2]?.[1]?.body as string) as { stops: { windowStart: string }[] };
    expect(body.stops[0]?.windowStart).toBe("2026-12-01T20:00:00.000Z");
    expect((calls[2]?.[1]?.headers as Record<string, string>)["x-organization-id"]).toBe(ORG);
  });

  it("changes an existing transport with PATCH", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = sequence(
      [200, { timezone: "America/Chicago" }],
      [200, { timezone: "America/Denver" }],
      [200, { id: ID }],
    );
    await saveTransport(sessionId, ID, filled(), deps, fetchFn);
    const last = vi.mocked(fetchFn).mock.calls[2];
    expect(last?.[0]).toBe(`http://127.0.0.1:4000/v1/transports/${ID}`);
    expect(last?.[1]?.method).toBe("PATCH");
  });

  it("does not call the API for a form with errors", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = sequence(
      [200, { timezone: "America/Chicago" }],
      [200, { timezone: "America/Denver" }],
    );
    const result = await saveTransport(
      sessionId,
      undefined,
      { ...filled(), customerId: "" },
      deps,
      fetchFn,
    );
    expect(result.status).toBe("invalid");
    expect(result).toHaveProperty("errors.customerId");
    expect(vi.mocked(fetchFn).mock.calls).toHaveLength(2);
  });

  it("maps the API's field errors back to form fields", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = sequence(
      [200, { timezone: "America/Chicago" }],
      [200, { timezone: "America/Denver" }],
      [
        400,
        {
          code: "validation_failed",
          errors: [
            { path: "stops.0.windowEnd", message: "bad", code: "x" },
            { path: "carrierId", message: "not found or archived", code: "invalid_reference" },
          ],
        },
      ],
    );
    expect(await saveTransport(sessionId, undefined, filled(), deps, fetchFn)).toEqual({
      status: "invalid",
      errors: { "stops.0.end": "bad", carrierId: "not found or archived" },
    });
  });

  it.each([
    [409, "transport_not_editable", "transport_not_editable"],
    [409, "carrier_required", "carrier_required"],
    [403, "permission_denied", "forbidden"],
    [404, "not_found", "not_found"],
    [401, "unauthorized", "signed_out"],
    [500, "internal_error", "unavailable"],
  ])("maps HTTP %i %s to %s", async (status, code, expected) => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = sequence(
      [200, { timezone: "America/Chicago" }],
      [200, { timezone: "America/Denver" }],
      [status, { code }],
    );
    const result = await saveTransport(sessionId, ID, filled(), deps, fetchFn);
    expect(result.status).toBe(expected);
  });

  it("is signed out without a session", async () => {
    const result = await saveTransport(undefined, undefined, filled(), makeDeps(), sequence());
    expect(result.status).toBe("signed_out");
  });
});

describe("changeTransportStatus", () => {
  it("sends the status and the note", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = sequence([200, { id: ID }]);
    expect(await changeTransportStatus(sessionId, ID, "planned", "ok", deps, fetchFn)).toBe("done");
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe(`http://127.0.0.1:4000/v1/transports/${ID}/status`);
    expect(JSON.parse(init?.body as string)).toEqual({ status: "planned", note: "ok" });
  });

  it("leaves the note out when empty", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = sequence([200, { id: ID }]);
    await changeTransportStatus(sessionId, ID, "planned", "", deps, fetchFn);
    expect(JSON.parse(vi.mocked(fetchFn).mock.calls[0]?.[1]?.body as string)).toEqual({
      status: "planned",
    });
  });

  it.each([
    [409, "invalid_transition", "invalid_transition"],
    [409, "carrier_required", "carrier_required"],
    [404, "x", "not_found"],
    [403, "x", "forbidden"],
    [401, "x", "signed_out"],
    [500, "x", "unavailable"],
  ])("maps HTTP %i %s to %s", async (status, code, expected) => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    expect(
      await changeTransportStatus(sessionId, ID, "planned", "", deps, sequence([status, { code }])),
    ).toBe(expected);
  });
});
