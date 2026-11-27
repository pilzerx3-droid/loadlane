import { describe, expect, it } from "vitest";
import {
  formatDateInZone,
  formatInZone,
  formatWindow,
  isoToLocalInput,
  parseLocalDateTime,
  localTimeToIso,
} from "./time.ts";

describe("localTimeToIso", () => {
  it("reads a time in the zone it was typed for", () => {
    // December: Chicago is UTC-6, Denver UTC-7, New York UTC-5.
    expect(localTimeToIso("2026-12-01T14:00", "America/Chicago")).toBe("2026-12-01T20:00:00.000Z");
    expect(localTimeToIso("2026-12-01T14:00", "America/Denver")).toBe("2026-12-01T21:00:00.000Z");
    expect(localTimeToIso("2026-12-01T14:00", "America/New_York")).toBe("2026-12-01T19:00:00.000Z");
  });

  it("follows daylight saving time", () => {
    // July: Chicago is UTC-5.
    expect(localTimeToIso("2026-07-01T14:00", "America/Chicago")).toBe("2026-07-01T19:00:00.000Z");
    // Arizona has no daylight saving time: UTC-7 all year.
    expect(localTimeToIso("2026-07-01T14:00", "America/Phoenix")).toBe("2026-07-01T21:00:00.000Z");
  });

  it("handles the day clocks change", () => {
    // 2026-03-08: clocks go forward at 02:00 in the US. 01:30 is still standard time (UTC-6 in Chicago).
    expect(localTimeToIso("2026-03-08T01:30", "America/Chicago")).toBe("2026-03-08T07:30:00.000Z");
    // 03:30 is daylight time (UTC-5).
    expect(localTimeToIso("2026-03-08T03:30", "America/Chicago")).toBe("2026-03-08T08:30:00.000Z");
    // 2026-11-01: clocks go back. 00:30 is still daylight time, 03:00 is standard time.
    expect(localTimeToIso("2026-11-01T00:30", "America/Chicago")).toBe("2026-11-01T05:30:00.000Z");
    expect(localTimeToIso("2026-11-01T03:00", "America/Chicago")).toBe("2026-11-01T09:00:00.000Z");
  });

  it("works for zones east of UTC and across the date line", () => {
    expect(localTimeToIso("2026-12-01T00:00", "Pacific/Honolulu")).toBe("2026-12-01T10:00:00.000Z");
    expect(localTimeToIso("2026-12-01T09:00", "Europe/Berlin")).toBe("2026-12-01T08:00:00.000Z");
  });

  it.each([
    "",
    "2026-12-01",
    "2026-12-01 14:00",
    "2026-13-01T14:00",
    "2026-02-30T10:00",
    "2026-12-01T25:00",
    "nonsense",
  ])("rejects %j", (text) => {
    expect(localTimeToIso(text, "America/Chicago")).toBeUndefined();
  });
});

describe("isoToLocalInput", () => {
  it("is the inverse of localTimeToIso", () => {
    for (const [local, zone] of [
      ["2026-12-01T14:00", "America/Chicago"],
      ["2026-07-04T23:59", "America/Denver"],
      ["2026-03-08T03:30", "America/Chicago"],
      ["2026-01-01T00:00", "America/Los_Angeles"],
    ] as const) {
      const iso = localTimeToIso(local, zone);
      expect(iso).toBeDefined();
      expect(isoToLocalInput(iso ?? "", zone)).toBe(local);
    }
  });

  it("shows the same instant differently in different zones", () => {
    expect(isoToLocalInput("2026-12-01T20:00:00.000Z", "America/Chicago")).toBe("2026-12-01T14:00");
    expect(isoToLocalInput("2026-12-01T20:00:00.000Z", "America/Los_Angeles")).toBe(
      "2026-12-01T12:00",
    );
  });
});

describe("formatting", () => {
  it("uses the US format with the zone abbreviation", () => {
    expect(formatInZone("2026-12-01T20:00:00.000Z", "America/Chicago")).toBe(
      "12/01/2026 2:00 PM CST",
    );
    expect(formatInZone("2026-07-01T19:00:00.000Z", "America/Chicago")).toBe(
      "07/01/2026 2:00 PM CDT",
    );
    expect(formatDateInZone("2026-12-02T03:00:00.000Z", "America/Chicago")).toBe("12/01/2026");
  });

  it("shows a window on one day with the date once", () => {
    expect(
      formatWindow("2026-12-01T20:00:00.000Z", "2026-12-01T22:00:00.000Z", "America/Chicago"),
    ).toBe("12/01/2026 2:00 PM CST – 4:00 PM CST");
  });

  it("repeats the date when the window spans midnight and shows one time for an instant", () => {
    expect(
      formatWindow("2026-12-02T03:00:00.000Z", "2026-12-02T07:00:00.000Z", "America/Chicago"),
    ).toBe("12/01/2026 9:00 PM CST – 12/02/2026 1:00 AM CST");
    expect(
      formatWindow("2026-12-01T20:00:00.000Z", "2026-12-01T20:00:00.000Z", "America/Chicago"),
    ).toBe("12/01/2026 2:00 PM CST");
  });
});

describe("parseLocalDateTime", () => {
  it.each([
    ["2026-12-01 14:30", "2026-12-01T14:30"],
    ["2026-12-01T14:30", "2026-12-01T14:30"],
    ["2026-12-1 9:05", "2026-12-01T09:05"],
    ["12/01/2026 14:30", "2026-12-01T14:30"],
    ["1/5/2026 8:00", "2026-01-05T08:00"],
    ["12/01/2026 2:30 PM", "2026-12-01T14:30"],
    ["12/01/2026 2:30pm", "2026-12-01T14:30"],
    ["12/01/2026 12:00 AM", "2026-12-01T00:00"],
    ["12/01/2026 12:00 PM", "2026-12-01T12:00"],
    ["  12/01/2026 12:15 pm ", "2026-12-01T12:15"],
  ])("reads %j as %s", (text, expected) => {
    expect(parseLocalDateTime(text)).toBe(expected);
  });

  it.each([
    "",
    "tomorrow",
    "2026-12-01",
    "12/01/2026",
    "13/01/2026 10:00",
    "02/30/2026 10:00",
    "12/01/2026 25:00",
    "12/01/2026 13:00 PM",
    "12/01/2026 0:30 AM",
    "12/01/2026 10:75",
    "2026-02-30 10:00",
  ])("rejects %j", (text) => {
    expect(parseLocalDateTime(text)).toBeUndefined();
  });
});
