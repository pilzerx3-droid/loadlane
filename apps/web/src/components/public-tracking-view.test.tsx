import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicTracking } from "../lib/tracking-links";
import { PublicTrackingView } from "./public-tracking-view";

const tracking: PublicTracking = {
  reference: "LL-000042",
  customerReference: "PO-4711",
  status: "in_transit",
  stops: [
    {
      sequence: 1,
      type: "pickup",
      placeName: "Dock 4",
      city: "Dallas",
      state: "TX",
      windowStart: "2030-12-01T20:00:00.000Z",
      windowEnd: "2030-12-01T22:00:00.000Z",
      timezone: "America/Chicago",
    },
  ],
  history: [
    { status: "created", occurredAt: "2030-11-30T15:00:00.000Z" },
    { status: "in_transit", occurredAt: "2030-12-01T21:00:00.000Z" },
  ],
};

describe("PublicTrackingView", () => {
  it("shows reference, status, stops and history newest first", () => {
    const html = renderToStaticMarkup(<PublicTrackingView tracking={tracking} />);
    expect(html).toContain("LL-000042");
    expect(html).toContain("Your reference: PO-4711");
    expect(html).toContain("In transit");
    expect(html).toContain("Dallas, TX");
    expect(html).toContain("2:00 PM");
    expect(html.indexOf("In transit")).toBeLessThan(html.lastIndexOf("Created"));
  });

  it("states that no live position is shown", () => {
    const html = renderToStaticMarkup(<PublicTrackingView tracking={tracking} />);
    expect(html).toContain("Live vehicle positions are not shown");
  });
});
