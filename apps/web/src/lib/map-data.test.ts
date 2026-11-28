import { describe, expect, it } from "vitest";
import { describeAge, FRESHNESS_LABELS } from "@loadlane/shared";
import { mapPoints, type MapData } from "./map-data";

const data: MapData = {
  generatedAt: "2030-12-01T12:00:00.000Z",
  transports: [
    {
      id: "t1",
      reference: "LL-000001",
      status: "in_transit",
      customerReference: null,
      stops: [
        {
          sequence: 1,
          type: "pickup",
          locationId: "l1",
          placeName: "Dallas Dock",
          city: "Dallas",
          state: "TX",
          windowStart: "2030-12-01T14:00:00.000Z",
          windowEnd: "2030-12-01T16:00:00.000Z",
          timezone: "America/Chicago",
          latitude: 32.78,
          longitude: -96.8,
        },
        {
          sequence: 2,
          type: "delivery",
          locationId: "l2",
          placeName: "Houston Dock",
          city: "Houston",
          state: "TX",
          windowStart: "2030-12-02T14:00:00.000Z",
          windowEnd: "2030-12-02T16:00:00.000Z",
          timezone: "America/Chicago",
          latitude: null,
          longitude: null,
        },
      ],
      lastPosition: {
        latitude: 31.5,
        longitude: -97.1,
        recordedAt: "2030-12-01T10:00:00.000Z",
        ageMs: 2 * 3_600_000,
        freshness: "stale",
        lowQuality: true,
      },
    },
    {
      id: "t2",
      reference: "LL-000002",
      status: "planned",
      customerReference: null,
      stops: [],
      lastPosition: null,
    },
  ],
  locationsWithoutCoordinates: [{ id: "l2", name: "Houston Dock", city: "Houston", state: "TX" }],
};

describe("mapPoints", () => {
  it("draws stops with coordinates and the reported position, and skips everything else", () => {
    const points = mapPoints(data, describeAge, (freshness) => FRESHNESS_LABELS[freshness]);
    expect(points.map((point) => [point.kind, point.transportId])).toEqual([
      ["pickup", "t1"],
      ["position", "t1"],
    ]);
    expect(points[0]).toMatchObject({
      title: "LL-000001 · Pickup",
      detail: "Dallas Dock, Dallas, TX",
    });
    expect(points[1]?.detail).toContain("Reported 2 h ago");
    expect(points[1]?.detail).toContain("low accuracy");
    expect(points[1]?.freshness).toBe("stale");
  });

  it("makes no position for a transport that has not reported one", () => {
    const points = mapPoints(data, describeAge, (freshness) => FRESHNESS_LABELS[freshness]);
    expect(points.some((point) => point.transportId === "t2")).toBe(false);
  });
});
