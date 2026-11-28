import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EtaCard, type EtaInfo } from "./eta-card";

const now = new Date("2030-12-01T12:00:00Z");
const estimate: NonNullable<EtaInfo["estimate"]> = {
  estimatedArrival: "2030-12-01T15:30:00Z",
  computedAt: "2030-12-01T11:55:00Z",
  basedOnPositionAt: "2030-12-01T11:50:00Z",
  distanceMiles: 201.4,
  drivingMinutes: 205,
  provider: "openrouteservice",
  excludesTrafficAndBreaks: true,
};

function html(eta: EtaInfo, windowEnd: string | null = null) {
  return renderToStaticMarkup(
    <EtaCard eta={eta} windowEnd={windowEnd} timeZone="America/Chicago" now={now} />,
  );
}

describe("EtaCard", () => {
  it("shows the estimate with its basis and what it leaves out", () => {
    const text = html({ estimate, routingConfigured: true });
    expect(text).toContain("9:30");
    expect(text).toContain("201.4 mi");
    expect(text).toContain("3 h 25 min of driving");
    expect(text).toContain("reported 10 min ago");
    expect(text).toContain("OpenRouteService");
    expect(text).toContain("traffic, rest breaks and waiting are not included");
    expect(text).not.toContain("After the delivery window");
  });

  it("marks an arrival after the end of the delivery window", () => {
    expect(html({ estimate, routingConfigured: true }, "2030-12-01T15:00:00Z")).toContain(
      "After the delivery window",
    );
    expect(html({ estimate, routingConfigured: true }, "2030-12-01T16:00:00Z")).not.toContain(
      "After the delivery window",
    );
  });

  it("says why there is no estimate instead of showing a time", () => {
    expect(html({ estimate: null, routingConfigured: false })).toContain("no routing service");
    const waiting = html({ estimate: null, routingConfigured: true });
    expect(waiting).toContain("No current estimate");
    expect(waiting).not.toContain("driving from");
  });
});
