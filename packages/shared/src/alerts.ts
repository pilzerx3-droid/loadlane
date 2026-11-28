// Alert conditions derived from planned windows and recorded positions (ADR 0016). Nothing here
// estimates an arrival time: every condition is a fact about the plan or about the data received.

import { positionFreshness } from "./position.ts";
import type { TransportStatus } from "./transport-status.ts";

export const ALERT_CONDITIONS = [
  "overdue_pickup",
  "overdue_delivery",
  "position_stale",
  "no_position",
] as const;
export type AlertCondition = (typeof ALERT_CONDITIONS)[number];

export const ALERT_LABELS: Record<AlertCondition, string> = {
  overdue_pickup: "Pickup window has passed, not loaded yet",
  overdue_delivery: "Delivery window has passed, not delivered yet",
  position_stale: "Last position is outdated",
  no_position: "On the road, no position received",
};

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
  return found;
}
