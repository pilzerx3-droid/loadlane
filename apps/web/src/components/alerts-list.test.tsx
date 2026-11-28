import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AlertsList, type AlertItem } from "./alerts-list";

const item: AlertItem = {
  id: "11111111-1111-4111-8111-111111111111",
  reference: "LL-000007",
  status: "in_transit",
  conditions: ["no_position", "overdue_delivery"],
  customerName: "Acme",
  carrierName: "Blue Line",
  firstPickupEnd: "2030-12-01T20:00:00.000Z",
  lastDeliveryEnd: "2030-12-02T20:00:00.000Z",
  lastPositionAt: null,
};

describe("AlertsList", () => {
  it("shows an honest empty state", () => {
    const html = renderToStaticMarkup(<AlertsList items={[]} timeZone="UTC" />);
    expect(html).toContain("Nothing needs attention");
  });

  it("lists each reason in words and links to the transport", () => {
    const html = renderToStaticMarkup(<AlertsList items={[item]} timeZone="America/Chicago" />);
    expect(html).toContain('href="/transports/11111111-1111-4111-8111-111111111111"');
    expect(html).toContain("On the road, no position received");
    expect(html).toContain("Delivery window has passed");
    expect(html).toContain("Acme · Blue Line");
  });
});
