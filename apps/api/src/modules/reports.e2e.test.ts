// End-to-end tests of the commercial report: every figure is computed from stored data and checked
// against a scenario whose answers are known; periods, permissions and tenant isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rateBp } from "./reporting/report-service.ts";
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
  const person = await api.person("reports");
  const organizationId = await api.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles: [role] }],
  });
  const as: As = { token: person.token, organizationId };
  return { as, organizationId };
}

async function report(as: As, query = "") {
  const response = await api.call(`/v1/reports/commercial${query}`, as);
  expect(response.status).toBe(200);
  return body(response);
}

describe("rateBp", () => {
  it("rounds half up and is null without a denominator", () => {
    expect(rateBp(1, 2)).toBe(5_000);
    expect(rateBp(13_500, 103_500)).toBe(1_304);
    expect(rateBp(1, 3)).toBe(3_333);
    expect(rateBp(-1, 3)).toBe(-3_333);
    expect(rateBp(5, 0)).toBeNull();
  });
});

describe("GET /v1/reports/commercial", () => {
  it("computes the figures of a known scenario and nothing more", async () => {
    const w = await workspace();
    const customer = await body(
      await api.call("/v1/customers", { ...w.as, json: { name: "Acme" } }),
    );
    const carrier = await body(
      await api.call("/v1/carriers", { ...w.as, json: { name: "Blue Line" } }),
    );
    const location = await body(
      await api.call("/v1/locations", {
        ...w.as,
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
    const transport = async (windowEnd: string, carrierId: unknown = undefined) => {
      const stop = (type: string) => ({
        type,
        locationId: location["id"],
        windowStart: "2019-12-31T10:00:00-06:00",
        windowEnd,
      });
      const made = await body(
        await api.call("/v1/transports", {
          ...w.as,
          json: {
            customerId: customer["id"],
            carrierId,
            stops: [stop("pickup"), stop("delivery")],
          },
        }),
      );
      return String(made["id"]);
    };
    const move = async (id: string, statuses: string[]) => {
      for (const status of statuses)
        await api.call(`/v1/transports/${id}/status`, { ...w.as, json: { status } });
    };
    const road = [
      "planned",
      "assigned",
      "confirmed",
      "in_transit",
      "at_destination",
      "unloading",
      "delivered",
    ];

    // Deliveries: one before its window ended (on time), one after (late).
    await move(await transport("2099-01-01T12:00:00-06:00", carrier["id"]), road);
    await move(await transport("2020-01-01T12:00:00-06:00", carrier["id"]), road);

    // Spot freight: one offer awarded below its target, one cancelled.
    const tender = async (transportId: string, extra: Json = {}) =>
      body(
        await api.call("/v1/spot-tenders", {
          ...w.as,
          json: {
            transportId,
            responseDeadline: new Date(Date.now() + 86_400_000).toISOString(),
            carrierIds: [carrier["id"]],
            ...extra,
          },
        }),
      );
    const first = await tender(await transport("2099-01-01T12:00:00-06:00"), {
      targetPriceCents: 90_000,
    });
    await api.call(`/v1/spot-tenders/${String(first["id"])}/bids`, {
      ...w.as,
      json: { carrierId: carrier["id"], priceCents: 85_000 },
    });
    const bid = (
      (await body(await api.call(`/v1/spot-tenders/${String(first["id"])}`, w.as)))[
        "bids"
      ] as Json[]
    )[0] as Json;
    await api.call(`/v1/spot-tenders/${String(first["id"])}/award`, {
      ...w.as,
      json: { bidId: bid["id"] },
    });
    const second = await tender(await transport("2099-01-01T12:00:00-06:00"));
    await api.call(`/v1/spot-tenders/${String(second["id"])}/cancel`, { ...w.as, json: {} });

    // Quotes: one accepted ($1,035, contribution $135), one rejected, one still a draft.
    const calculation = String(
      (
        await body(
          await api.call("/v1/calculations", {
            ...w.as,
            json: {
              name: "Lane",
              customerId: customer["id"],
              lines: [{ kind: "base_freight", label: "Rate", amountCents: 90_000 }],
              pricing: { mode: "markup", rateBp: 1_500 },
            },
          }),
        )
      )["id"],
    );
    const quote = async () =>
      String(
        (
          await body(
            await api.call("/v1/quotes", {
              ...w.as,
              json: { calculationId: calculation, validUntil: "2099-01-01" },
            }),
          )
        )["id"],
      );
    const decide = async (id: string, final: string) => {
      for (const status of ["sent", final])
        await api.call(`/v1/quotes/${id}/status`, { ...w.as, json: { status } });
    };
    await decide(await quote(), "accepted");
    await decide(await quote(), "rejected");
    await quote();

    const result = await report(w.as);
    expect(result["spot"]).toEqual({
      offers: 2,
      awarded: 1,
      cancelled: 1,
      stillOpen: 0,
      awardRateBp: 5_000,
      bidsPerOffer: 0.5,
      averageAwardedPriceCents: 85_000,
      offersWithTarget: 1,
      belowTargetCents: 5_000,
    });
    expect(result["quotes"]).toEqual({
      created: 3,
      sent: 2,
      accepted: 1,
      rejected: 1,
      acceptanceRateBp: 5_000,
      acceptedValueCents: 103_500,
      acceptedContributionCents: 13_500,
      acceptedMarginBp: 1_304,
    });
    expect(result["deliveries"]).toEqual({
      delivered: 2,
      withDeliveryWindow: 2,
      onTime: 1,
      onTimeRateBp: 5_000,
    });
    expect(String(result["note"])).toContain("Nothing is estimated");
  });

  it("shows nothing instead of invented numbers for an organization without data", async () => {
    const w = await workspace();
    const result = await report(w.as);
    expect(result["spot"]).toMatchObject({
      offers: 0,
      awardRateBp: null,
      bidsPerOffer: null,
      averageAwardedPriceCents: null,
    });
    expect(result["quotes"]).toMatchObject({
      created: 0,
      acceptanceRateBp: null,
      acceptedMarginBp: null,
    });
    expect(result["deliveries"]).toMatchObject({ delivered: 0, onTimeRateBp: null });
  });

  it("counts only what happened inside the period", async () => {
    const w = await workspace();
    await api.call("/v1/customers", { ...w.as, json: { name: "Acme" } });
    const past = await report(w.as, "?from=2020-01-01&to=2020-01-31");
    expect(past["period"]).toEqual({ from: "2020-01-01", to: "2020-01-31" });
    expect(past["quotes"]).toMatchObject({ created: 0 });
  });

  it("refuses periods that end before they start or are longer than a year", async () => {
    const w = await workspace();
    for (const query of [
      "?from=2030-02-01&to=2030-01-01",
      "?from=2020-01-01&to=2022-01-01",
      "?from=soon",
      "?to=2030-13-45x",
    ]) {
      expect((await api.call(`/v1/reports/commercial${query}`, w.as)).status, query).toBe(400);
    }
    expect(
      (await api.call("/v1/reports/commercial?from=2030-01-01&to=2030-01-01", w.as)).status,
    ).toBe(200);
  });

  it.each([
    ["admin", 200],
    ["sales", 200],
    ["dispatcher", 403],
    ["carrier_user", 403],
  ])("%s -> %i", async (role, expected) => {
    const w = await workspace(role);
    expect((await api.call("/v1/reports/commercial", w.as)).status).toBe(expected);
  });

  it("never mixes organizations", async () => {
    const a = await workspace();
    const b = await workspace();
    const customer = await body(
      await api.call("/v1/customers", { ...a.as, json: { name: "Acme" } }),
    );
    await api.call("/v1/calculations", {
      ...a.as,
      json: {
        name: "x",
        customerId: customer["id"],
        lines: [{ kind: "toll", label: "x", amountCents: 100 }],
        pricing: { mode: "markup", rateBp: 0 },
      },
    });
    const calc = (
      await api.ownerRows("SELECT id FROM calculation WHERE organization_id = $1", [
        a.organizationId,
      ])
    )[0] as Json;
    await api.call("/v1/quotes", {
      ...a.as,
      json: { calculationId: calc["id"], validUntil: "2099-01-01" },
    });
    expect((await report(a.as))["quotes"]).toMatchObject({ created: 1 });
    expect((await report(b.as))["quotes"]).toMatchObject({ created: 0 });
  });
});
