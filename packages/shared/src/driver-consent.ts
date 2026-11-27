// The consent screen a driver sees before any position is shared (ADR 0015, CLAUDE.md rule 5).
// The API and the driver page both read it from here, so the text a driver agrees to is the text
// the API recorded the version of. Changing the wording means raising CONSENT_TEXT_VERSION.
//
// OPEN (legal): this wording and the retention period must be reviewed by counsel before real
// drivers use it. Until then the page labels it as a draft.

export const CONSENT_TEXT_VERSION = 1;

/** Statuses a driver may report themselves, in the order of a normal trip. */
export const DRIVER_REPORTABLE_STATUSES = [
  "loading",
  "in_transit",
  "at_destination",
  "unloading",
  "delivered",
] as const;

export const DRIVER_STATUS_LABELS: Record<(typeof DRIVER_REPORTABLE_STATUSES)[number], string> = {
  loading: "Started loading",
  in_transit: "On the road",
  at_destination: "Arrived at destination",
  unloading: "Started unloading",
  delivered: "Delivered",
};

export const CONSENT_COPY = {
  title: "Share your position?",
  points: [
    "What is collected: your phone's location (latitude, longitude and accuracy) and the time.",
    "When: only while this page is open and sharing is on. It stops when you close the page or press Stop sharing.",
    "Who sees it: the company that booked this transport and the carrier on it.",
    "How long: kept for a limited time after the transport is finished, then deleted.",
    "Your choice: you can decline and still report status updates by hand. You can stop sharing at any time.",
  ],
  accept: "Agree and share my position",
  decline: "No thanks, report status by hand",
} as const;
