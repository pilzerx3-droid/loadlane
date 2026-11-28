import { describe, expect, it } from "vitest";
import { alertConditions, type AlertInput } from "./alerts.ts";

const now = new Date("2030-01-01T12:00:00Z");
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const base: AlertInput = {
  status: "confirmed",
  firstPickupEnd: at(60),
  lastDeliveryEnd: at(600),
  lastPositionRecordedAt: null,
};

describe("alertConditions", () => {
  it("has no alert for a transport that is on plan", () => {
    expect(alertConditions(base, now)).toEqual([]);
  });

  it("flags a pickup window that passed before loading started", () => {
    expect(alertConditions({ ...base, firstPickupEnd: at(-5) }, now)).toEqual(["overdue_pickup"]);
  });

  it("does not flag the pickup once the freight is loading", () => {
    const input = { ...base, status: "loading" as const, firstPickupEnd: at(-5) };
    expect(alertConditions({ ...input, lastPositionRecordedAt: at(-1) }, now)).toEqual([]);
  });

  it("flags a delivery window that passed before delivery", () => {
    const input = {
      ...base,
      status: "in_transit" as const,
      lastDeliveryEnd: at(-1),
      lastPositionRecordedAt: at(-1),
    };
    expect(alertConditions(input, now)).toEqual(["overdue_delivery"]);
  });

  it("flags a transport on the road without a position", () => {
    expect(alertConditions({ ...base, status: "in_transit" }, now)).toEqual(["no_position"]);
  });

  it("flags an outdated position, but not a recent one", () => {
    const road = { ...base, status: "in_transit" as const };
    expect(alertConditions({ ...road, lastPositionRecordedAt: at(-45) }, now)).toEqual([
      "position_stale",
    ]);
    expect(alertConditions({ ...road, lastPositionRecordedAt: at(-10) }, now)).toEqual([]);
  });

  it("never flags finished or cancelled transports", () => {
    for (const status of ["delivered", "completed", "cancelled"] as const) {
      expect(alertConditions({ ...base, status, lastDeliveryEnd: at(-999) }, now)).toEqual([]);
    }
  });

  it("does not ask for positions before the freight is on the road", () => {
    expect(alertConditions({ ...base, status: "assigned" }, now)).toEqual([]);
  });
});
