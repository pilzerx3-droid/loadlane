// The status model of a quote, defined once (like transport-status.ts). A quote is drafted,
// sent to the customer, then accepted or rejected. "Expired" is not a status: a sent quote whose
// validity date has passed is shown as expired, which is derived from the date and never stored.

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected", "cancelled"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const QUOTE_TRANSITIONS: Readonly<Record<QuoteStatus, readonly QuoteStatus[]>> = {
  draft: ["sent", "cancelled"],
  sent: ["accepted", "rejected", "cancelled"],
  accepted: [],
  rejected: [],
  cancelled: [],
};

export function isQuoteStatus(value: string): value is QuoteStatus {
  return (QUOTE_STATUSES as readonly string[]).includes(value);
}

export function canQuoteTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[from].includes(to);
}

export function nextQuoteStatuses(from: QuoteStatus): readonly QuoteStatus[] {
  return QUOTE_TRANSITIONS[from];
}

/** Only a draft may still be edited; a sent quote is what the customer saw. */
export function isQuoteEditable(status: QuoteStatus): boolean {
  return status === "draft";
}

/** A sent quote is expired once its last valid day (YYYY-MM-DD) is before `today` (YYYY-MM-DD). */
export function isQuoteExpired(status: QuoteStatus, validUntil: string, today: string): boolean {
  return status === "sent" && validUntil < today;
}
