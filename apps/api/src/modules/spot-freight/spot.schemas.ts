import { z } from "zod";
import { optionalText } from "../../platform/directory-http.ts";

// Money is whole US cents (`...Cents`). A bid carries a price and nothing else that is money.

const cents = z.number().int().min(1).max(100_000_000_000);
const tenderStatus = z.enum(["open", "awarded", "cancelled", "closed"]);
const bidStatus = z.enum(["submitted", "superseded", "withdrawn", "rejected", "awarded"]);

export const createTenderSchema = z.strictObject({
  transportId: z
    .uuid()
    .describe("A transport that is created or planned, without a spot freight offer that is open"),
  responseDeadline: z.iso.datetime({ offset: true }).describe("Until when carriers may bid"),
  targetPriceCents: z
    .number()
    .int()
    .min(0)
    .max(100_000_000_000)
    .nullable()
    .optional()
    .describe("Your own target price. Internal: carriers never see it."),
  notes: optionalText(2000).describe("Internal notes"),
  carrierIds: z.array(z.uuid()).min(1).max(20).describe("Carriers to invite"),
  inviteDays: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe("How long the carrier links stay valid"),
  sendEmail: z
    .boolean()
    .optional()
    .describe("E-mail each carrier its link, to the contact address stored on the carrier"),
});

export const inviteSchema = z.strictObject({
  carrierId: z.uuid(),
  inviteDays: z.number().int().min(1).max(30).optional(),
  sendEmail: z.boolean().optional(),
});

export const manualBidSchema = z.strictObject({
  carrierId: z.uuid(),
  priceCents: cents,
  note: optionalText(500),
});

export const awardSchema = z.strictObject({
  bidId: z.uuid(),
  note: optionalText(500).describe("Why this carrier, for the record"),
});

export const tenderListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  status: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(",") : undefined))
    .pipe(z.array(tenderStatus).optional()),
});

const carrierRef = z.object({ id: z.uuid(), name: z.string() });

export const tenderSummarySchema = z.object({
  id: z.uuid(),
  status: tenderStatus,
  transport: z.object({ id: z.uuid(), reference: z.string(), status: z.string() }),
  origin: z.string(),
  destination: z.string(),
  responseDeadline: z.iso.datetime(),
  deadlinePassed: z.boolean(),
  invited: z.number().int(),
  liveBids: z.number().int().describe("Bids that are currently valid"),
  lowestLiveBidCents: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
});

export const tenderDetailSchema = tenderSummarySchema.extend({
  targetPriceCents: z.number().int().nullable(),
  notes: z.string().nullable(),
  awardedAt: z.iso.datetime().nullable(),
  awardedBy: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  stops: z.array(
    z.object({
      sequence: z.number().int(),
      type: z.enum(["pickup", "delivery"]),
      placeName: z.string(),
      city: z.string(),
      state: z.string(),
      windowStart: z.iso.datetime(),
      windowEnd: z.iso.datetime(),
      timezone: z.string(),
    }),
  ),
  invitations: z.array(
    z.object({
      id: z.uuid(),
      carrier: carrierRef,
      state: z.enum(["active", "expired", "revoked"]),
      expiresAt: z.iso.datetime(),
    }),
  ),
  bids: z.array(
    z.object({
      id: z.uuid(),
      carrier: carrierRef,
      priceCents: z.number().int(),
      note: z.string().nullable(),
      status: bidStatus,
      source: z.enum(["carrier_link", "staff"]),
      createdAt: z.iso.datetime(),
    }),
  ),
});

export const invitationMailSchema = z.object({
  carrierId: z.uuid(),
  status: z.enum(["sent", "failed", "skipped"]),
  /** mail_send_failed, or no_contact_email when the carrier has no address stored. */
  errorCode: z.string().nullable(),
});

export const createdTenderSchema = tenderDetailSchema.extend({
  links: z.array(z.object({ carrierId: z.uuid(), token: z.string() })).describe("Shown once"),
  mail: z.array(invitationMailSchema).optional().describe("Present only when sendEmail was set"),
});

export const invitedSchema = z.object({
  invitationId: z.uuid(),
  carrierId: z.uuid(),
  token: z.string(),
  expiresAt: z.iso.datetime(),
  mail: invitationMailSchema.optional(),
});

export const tenderListSchema = z.object({
  items: z.array(tenderSummarySchema),
  page: z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int() }),
});

// What a carrier sees through its link (ADR 0019): the lane, never the customer or the target price.
export const carrierOfferSchema = z.object({
  state: z.enum(["open", "deadline_passed", "awarded_to_you", "closed"]),
  transportReference: z.string(),
  responseDeadline: z.iso.datetime(),
  weightLb: z.number().nullable(),
  pieces: z.number().int().nullable(),
  stops: z.array(
    z.object({
      sequence: z.number().int(),
      type: z.enum(["pickup", "delivery"]),
      city: z.string(),
      state: z.string(),
      windowStart: z.iso.datetime(),
      windowEnd: z.iso.datetime(),
      timezone: z.string(),
    }),
  ),
  yourBid: z
    .object({
      priceCents: z.number().int(),
      note: z.string().nullable(),
      status: bidStatus,
      createdAt: z.iso.datetime(),
    })
    .nullable(),
});

export const carrierBidSchema = z.strictObject({ priceCents: cents, note: optionalText(500) });

export type CreateTenderInput = z.output<typeof createTenderSchema>;
export type TenderListQuery = z.output<typeof tenderListQuerySchema>;
export type TenderSummary = z.infer<typeof tenderSummarySchema>;
export type TenderDetail = z.infer<typeof tenderDetailSchema>;
export type CreatedTender = z.infer<typeof createdTenderSchema>;
export type TenderList = z.infer<typeof tenderListSchema>;
export type CarrierOffer = z.infer<typeof carrierOfferSchema>;
