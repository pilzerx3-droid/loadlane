// Plain-text e-mails. Pure functions: easy to test and nothing here talks to a server.
// Rules: say who sends it, what the link does and how long it works; never include costs or margins.

/** MM/DD/YYYY in UTC, the US default format. Mail has no viewer time zone, so the date is stated in UTC terms. */
export function usDate(iso: string): string {
  const date = new Date(iso);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${month}/${day}/${date.getUTCFullYear()}`;
}

export interface MailContent {
  subject: string;
  text: string;
}

/** The customer tracking link of one transport (ADR 0017). It never shows a driver position. */
export function trackingLinkMail(input: {
  senderName: string;
  reference: string;
  link: string;
  expiresOn: string;
}): MailContent {
  return {
    subject: `Track shipment ${input.reference}`,
    text: [
      `${input.senderName} shared a tracking page for shipment ${input.reference} with you.`,
      "",
      "You can see its status and the planned pickup and delivery windows here:",
      input.link,
      "",
      `The link works until ${input.expiresOn}. Anyone who has the link can open the page, so please do not forward it.`,
    ].join("\n"),
  };
}

/** The invitation of a carrier to bid on a spot freight offer (ADR 0019). */
export function spotInvitationMail(input: {
  senderName: string;
  carrierName: string;
  reference: string;
  origin: string;
  destination: string;
  deadline: string;
  link: string;
}): MailContent {
  return {
    subject: `Freight offer ${input.reference}: ${input.origin} to ${input.destination}`,
    text: [
      `Hello ${input.carrierName},`,
      "",
      `${input.senderName} invites you to bid on a shipment from ${input.origin} to ${input.destination}.`,
      `Bids are accepted until ${input.deadline}.`,
      "",
      "Open the offer, check the details and place your bid here:",
      input.link,
      "",
      "This link is personal to your company. Please do not forward it.",
    ].join("\n"),
  };
}

/** A quote sent to a customer, with the PDF attached. */
export function quoteMail(input: {
  senderName: string;
  customerName: string;
  reference: string;
  validUntil: string;
}): MailContent {
  return {
    subject: `Quote ${input.reference} from ${input.senderName}`,
    text: [
      `Hello ${input.customerName},`,
      "",
      `Please find our quote ${input.reference} attached. It is valid until ${input.validUntil}.`,
      "",
      "Kind regards",
      input.senderName,
    ].join("\n"),
  };
}
