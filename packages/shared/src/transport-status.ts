// The status model of a transport (ADR 0014). This file is the only definition: the API checks every
// change against it, the database accepts only these values, and the web app offers only the
// transitions it allows. "Delayed" is deliberately not a status: it is derived from ETA and appointment
// windows (Phase 4), so a delayed transport keeps its real status.

export const TRANSPORT_STATUSES = [
  "created",
  "planned",
  "assigned",
  "confirmed",
  "loading",
  "in_transit",
  "at_destination",
  "unloading",
  "delivered",
  "completed",
  "cancelled",
] as const;

export type TransportStatus = (typeof TRANSPORT_STATUSES)[number];

/**
 * Allowed next statuses. A transport moves forward; optional steps (loading, at destination,
 * unloading) may be skipped because not every customer reports them. It can be cancelled from any
 * status before it is delivered. Completed and cancelled are final.
 */
export const TRANSPORT_TRANSITIONS: Readonly<Record<TransportStatus, readonly TransportStatus[]>> =
  {
    created: ["planned", "cancelled"],
    planned: ["assigned", "cancelled"],
    assigned: ["confirmed", "cancelled"],
    confirmed: ["loading", "in_transit", "cancelled"],
    loading: ["in_transit", "cancelled"],
    in_transit: ["at_destination", "delivered", "cancelled"],
    at_destination: ["unloading", "delivered", "cancelled"],
    unloading: ["delivered", "cancelled"],
    delivered: ["completed"],
    completed: [],
    cancelled: [],
  };

export const TRANSPORT_STATUS_LABELS: Readonly<Record<TransportStatus, string>> = {
  created: "Created",
  planned: "Planned",
  assigned: "Assigned",
  confirmed: "Confirmed",
  loading: "Loading",
  in_transit: "In transit",
  at_destination: "At destination",
  unloading: "Unloading",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Statuses from which a carrier must be on the transport (the carrier has been assigned). */
export const STATUSES_REQUIRING_CARRIER: readonly TransportStatus[] = [
  "assigned",
  "confirmed",
  "loading",
  "in_transit",
  "at_destination",
  "unloading",
  "delivered",
  "completed",
];

export function isTransportStatus(value: string): value is TransportStatus {
  return (TRANSPORT_STATUSES as readonly string[]).includes(value);
}

export function nextTransportStatuses(from: TransportStatus): readonly TransportStatus[] {
  return TRANSPORT_TRANSITIONS[from];
}

export function canTransition(from: TransportStatus, to: TransportStatus): boolean {
  return TRANSPORT_TRANSITIONS[from].includes(to);
}

/** Final statuses: nothing changes after them. */
export function isFinalTransportStatus(status: TransportStatus): boolean {
  return TRANSPORT_TRANSITIONS[status].length === 0;
}

/** A transport is active while it can still change on the road: from assigned until delivered. */
export function isActiveTransportStatus(status: TransportStatus): boolean {
  return (
    STATUSES_REQUIRING_CARRIER.includes(status) && status !== "delivered" && status !== "completed"
  );
}
