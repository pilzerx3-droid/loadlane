import { describe, expect, it } from "vitest";
import { checkPosition, describeAge, positionAgeMs, positionFreshness } from "./position.ts";

const now = new Date("2030-01-01T12:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe("positionFreshness", () => {
  it.each([
    [0, "fresh"],
    [4.9, "fresh"],
    [5, "aging"],
    [29.9, "aging"],
    [30, "stale"],
    [600, "stale"],
  ])("%s minutes old is %s", (minutes, expected) => {
    expect(positionFreshness(ago(minutes), now)).toBe(expected);
  });

  it("accepts ISO strings and never reports a negative age", () => {
    expect(positionFreshness("2030-01-01T11:58:00Z", now)).toBe("fresh");
    expect(positionAgeMs(new Date(now.getTime() + 60_000), now)).toBe(0);
  });
});

describe("describeAge", () => {
  it.each([
    [10_000, "just now"],
    [4 * 60_000, "4 min ago"],
    [3 * 3_600_000, "3 h ago"],
    [72 * 3_600_000, "3 days ago"],
  ])("%s ms is %s", (ms, text) => {
    expect(describeAge(ms)).toBe(text);
  });
});

describe("checkPosition", () => {
  const good = { latitude: 32.78, longitude: -96.8, accuracyM: 10, recordedAt: ago(1) };

  it("accepts a normal report", () => {
    expect(checkPosition(good, now)).toEqual({ ok: true, lowQuality: false });
  });

  it("flags coarse accuracy without rejecting it", () => {
    expect(checkPosition({ ...good, accuracyM: 9_000 }, now)).toEqual({
      ok: true,
      lowQuality: true,
    });
    expect(checkPosition({ ...good, accuracyM: null }, now)).toEqual({
      ok: true,
      lowQuality: false,
    });
  });

  it.each([
    [{ latitude: 91 }, "invalid_coordinates"],
    [{ longitude: -181 }, "invalid_coordinates"],
    [{ latitude: Number.NaN }, "invalid_coordinates"],
    [{ accuracyM: -1 }, "invalid_accuracy"],
    [{ recordedAt: new Date(now.getTime() + 10 * 60_000) }, "recorded_in_future"],
    [{ recordedAt: new Date("nope") }, "recorded_in_future"],
  ])("rejects %o as %s", (patch, code) => {
    expect(checkPosition({ ...good, ...patch }, now)).toEqual({ ok: false, code });
  });

  it("tolerates a device clock a few minutes ahead", () => {
    expect(checkPosition({ ...good, recordedAt: new Date(now.getTime() + 60_000) }, now).ok).toBe(
      true,
    );
  });
});
