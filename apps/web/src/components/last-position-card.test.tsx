import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LastPositionCard } from "./last-position-card";

const now = new Date("2030-12-01T20:00:00Z");
const position = (minutesAgo: number, extra = {}) => ({
  latitude: 32.78123,
  longitude: -96.80045,
  accuracyM: 12.4,
  lowQuality: false,
  recordedAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
  receivedAt: new Date(now.getTime() - minutesAgo * 60_000 + 3_000).toISOString(),
  ...extra,
});
const html = (p: Parameters<typeof LastPositionCard>[0]["position"]) =>
  renderToStaticMarkup(<LastPositionCard position={p} timeZone="America/Chicago" now={now} />);

describe("LastPositionCard", () => {
  it("says so when there is no position instead of showing a guess", () => {
    const markup = html(null);
    expect(markup).toContain("No position received");
    expect(markup).not.toMatch(/\d+\.\d{5}/);
  });

  it("shows a fresh position with its time in the stop's zone and its age", () => {
    const markup = html(position(2));
    expect(markup).toContain("Live");
    expect(markup).toContain("32.78123, -96.80045");
    expect(markup).toContain("1:58 PM");
    expect(markup).toContain("2 min ago");
    expect(markup).toContain("Accuracy about 12 m");
  });

  it("marks an aging position as not recent", () => {
    expect(html(position(12))).toContain("Not recent");
  });

  it("marks an old position as outdated and explains why it may be old", () => {
    const markup = html(position(90));
    expect(markup).toContain("Outdated");
    expect(markup).toContain("This position is old");
    expect(markup).toContain("1 h ago");
  });

  it("warns when the accuracy is too coarse", () => {
    expect(html(position(1, { accuracyM: 9000, lowQuality: true }))).toContain("too coarse");
  });
});
