import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DriverJobView as Job } from "../lib/driver-api";
import { DriverJobView } from "./driver-job-view";

const job: Job = {
  reference: "LL-000042",
  status: "confirmed",
  nextStatuses: ["loading"],
  sharing: false,
  consent: null,
  consentTextVersion: 1,
  stops: [
    {
      sequence: 1,
      type: "pickup",
      windowStart: "2030-12-01T20:00:00.000Z",
      windowEnd: "2030-12-01T22:00:00.000Z",
      reference: "APPT-7",
      notes: "Use gate B",
      location: {
        name: "Dock 4",
        addressLine1: "1 Main St",
        addressLine2: null,
        city: "Dallas",
        state: "TX",
        postalCode: "75001",
        timezone: "America/Chicago",
      },
    },
  ],
};

describe("DriverJobView", () => {
  it("shows the reference, status, address and the window in the stop's own time zone", () => {
    const html = renderToStaticMarkup(<DriverJobView job={job} />);
    expect(html).toContain("LL-000042");
    expect(html).toContain("Confirmed");
    expect(html).toContain("1 Main St, Dallas, TX 75001");
    expect(html).toContain("2:00 PM");
    expect(html).toContain("Use gate B");
    expect(html).toContain("APPT-7");
  });
});
