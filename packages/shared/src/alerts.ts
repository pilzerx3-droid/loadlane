// Alert conditions derived from planned windows, recorded positions and, when a routing provider
// supplied one, an estimated arrival (ADR 0016, ADR 0021). Nothing here calculates an arrival time:
// every condition is a fact about the plan, about the data received, or about a stored estimate.

import { positionFreshness } from "./position.ts";
import type { TransportStatus } from "./transport-status.ts";

export const ALERT_CONDITIONS = [
  "overdue_pickup",
  "overdue_delivery",
  "position_stale",
  "no_position",
  "eta_late",
] as const;
export type AlertCondition = (typeof ALERT_CONDITIONS)[number];

export const ALERT_LABELS: Record<AlertCondition, string> = {
  overdue_pickup: "Pickup window has passed, not loaded yet",
  overdue_delivery: "Delivery window has passed, not delivered yet",
  position_stale: "Last position is outdated",
  no_position: "On the road, no position received",
  eta_late: "Estimated arrival is after the delivery window",
};

/** An estimate older than this is not used: the truck has moved on and no new one was calculated. */
export const ETA_MAX_AGE_MS = 30 * 60_000;

/** Whether a stored estimate is recent enough to show and to alert on. */
export function etaIsCurrent(computedAt: Date | string, now: Date): boolean {
  return now.getTime() - new Date(computedAt).getTime() <= ETA_MAX_AGE_MS;
}

const BEFORE_LOADING: readonly TransportStatus[] = ["created", "planned", "assigned", "confirmed"];
const ON_THE_ROAD: readonly TransportStatus[] = [
  "loading",
  "in_transit",
  "at_destination",
  "unloading",
];
const FINAL: readonly TransportStatus[] = ["delivered", "completed", "cancelled"];

export interface AlertInput {
  status: TransportStatus;
  firstPickupEnd: Date | string;
  lastDeliveryEnd: Date | string;
  lastPositionRecordedAt: Date | string | null;
  /** From a routing provider, and only passed in when it is current (see etaIsCurrent). */
  estimatedArrival?: Date | string | null;
}

export function alertConditions(input: AlertInput, now: Date): AlertCondition[] {
  const { status } = input;
  if (FINAL.includes(status)) return [];
  const found: AlertCondition[] = [];
  if (BEFORE_LOADING.includes(status) && new Date(input.firstPickupEnd) < now) {
    found.push("overdue_pickup");
  }
  if (new Date(input.lastDeliveryEnd) < now) found.push("overdue_delivery");
  if (ON_THE_ROAD.includes(status)) {
    if (input.lastPositionRecordedAt === null) found.push("no_position");
    else if (positionFreshness(input.lastPositionRecordedAt, now) === "stale") {
      found.push("position_stale");
    }
  }
  // A transport already past its window is "overdue"; "eta_late" is the early warning before that.
  if (
    input.estimatedArrival &&
    !found.includes("overdue_delivery") &&
    new Date(input.estimatedArrival) > new Date(input.lastDeliveryEnd)
  ) {
    found.push("eta_late");
  }
  return found;
}
