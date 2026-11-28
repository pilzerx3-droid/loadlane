import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use the format YYYY-MM-DD");

export const reportQuerySchema = z.object({
  from: day.optional().describe("First day, default 30 days ago (organization time zone)"),
  to: day.optional().describe("Last day, default today. At most 366 days after `from`."),
});

/** A rate as basis points of the whole (1 % = 100). Null when there is nothing to divide by. */
const rate = z.number().int().nullable();

export const commercialReportSchema = z.object({
  period: z.object({ from: day, to: day }),
  note: z.string().describe("What these figures are and are not"),
  spot: z.object({
    offers: z.number().int().describe("Offers created in the period"),
    awarded: z.number().int(),
    cancelled: z.number().int(),
    stillOpen: z.number().int(),
    awardRateBp: rate.describe("Awarded divided by offers that are no longer open"),
    bidsPerOffer: z.number().nullable().describe("Distinct carriers that bid, per offer"),
    averageAwardedPriceCents: z.number().int().nullable(),
    offersWithTarget: z.number().int().describe("Awarded offers that had a target price"),
    belowTargetCents: z
      .number()
      .int()
      .describe(
        "Sum over awarded offers with a target: target minus awarded price (negative: above target)",
      ),
  }),
  quotes: z.object({
    created: z.number().int(),
    sent: z.number().int().describe("Sent, accepted or rejected"),
    accepted: z.number().int(),
    rejected: z.number().int(),
    acceptanceRateBp: rate.describe("Accepted divided by accepted plus rejected"),
    acceptedValueCents: z.number().int(),
    acceptedContributionCents: z
      .number()
      .int()
      .describe("Contribution of the calculations behind accepted quotes"),
    acceptedMarginBp: rate.describe("Contribution divided by value of accepted quotes"),
  }),
  deliveries: z.object({
    delivered: z.number().int().describe("Transports moved to delivered in the period"),
    withDeliveryWindow: z.number().int(),
    onTime: z
      .number()
      .int()
      .describe("Delivered no later than the end of the last delivery window"),
    onTimeRateBp: rate,
  }),
});

export type ReportQuery = z.output<typeof reportQuerySchema>;
export type CommercialReport = z.infer<typeof commercialReportSchema>;
