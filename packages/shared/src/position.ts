// Rules about reported positions (ADR 0015). Shared by the API and the web app so both judge the
// age of a position the same way. Nothing here estimates or invents a position.

/** A position is fresh under 5 minutes old, aging under 30, stale beyond that. */
export const POSITION_FRESH_MS = 5 * 60_000;
export const POSITION_AGING_MS = 30 * 60_000;

/** Accuracy radius (meters) beyond which a position is stored but flagged as low quality. */
export const LOW_QUALITY_ACCURACY_M = 5_000;

/** A device clock may be this far ahead of the server before the report is rejected. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export type PositionFreshness = "fresh" | "aging" | "stale";

export const FRESHNESS_LABELS: Record<PositionFreshness, string> = {
  fresh: "Live",
  aging: "Not recent",
  stale: "Outdated",
};

/** How old a position is, judged by the time the device recorded it. Never negative. */
export function positionAgeMs(recordedAt: Date | string, now: Date): number {
  return Math.max(0, now.getTime() - new Date(recordedAt).getTime());
}

export function positionFreshness(recordedAt: Date | string, now: Date): PositionFreshness {
  const age = positionAgeMs(recordedAt, now);
  if (age < POSITION_FRESH_MS) return "fresh";
  if (age < POSITION_AGING_MS) return "aging";
  return "stale";
}

/** "just now", "4 min ago", "3 h ago", "2 days ago": for showing next to the timestamp. */
export function describeAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export interface PositionInput {
  latitude: number;
  longitude: number;
  accuracyM?: number | null | undefined;
  recordedAt: Date;
}

export type PositionCheck =
  | { ok: true; lowQuality: boolean }
  | { ok: false; code: "invalid_coordinates" | "invalid_accuracy" | "recorded_in_future" };

/** Judges a report from a device. Out-of-range values are rejected; coarse accuracy is only flagged. */
export function checkPosition(input: PositionInput, now: Date): PositionCheck {
  const { latitude, longitude, accuracyM, recordedAt } = input;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return { ok: false, code: "invalid_coordinates" };
  }
  if (accuracyM != null && (!Number.isFinite(accuracyM) || accuracyM < 0)) {
    return { ok: false, code: "invalid_accuracy" };
  }
  if (
    Number.isNaN(recordedAt.getTime()) ||
    recordedAt.getTime() - now.getTime() > MAX_CLOCK_SKEW_MS
  ) {
    return { ok: false, code: "recorded_in_future" };
  }
  return { ok: true, lowQuality: accuracyM != null && accuracyM > LOW_QUALITY_ACCURACY_M };
}
