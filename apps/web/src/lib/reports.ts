import { z } from "zod";

const rate = z.number().nullable();

export const commercialReportSchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  note: z.string(),
  spot: z.object({
    offers: z.number(),
    awarded: z.number(),
    cancelled: z.number(),
    stillOpen: z.number(),
    awardRateBp: rate,
    bidsPerOffer: z.number().nullable(),
    averageAwardedPriceCents: z.number().nullable(),
    offersWithTarget: z.number(),
    belowTargetCents: z.number(),
  }),
  quotes: z.object({
    created: z.number(),
    sent: z.number(),
    accepted: z.number(),
    rejected: z.number(),
    acceptanceRateBp: rate,
    acceptedValueCents: z.number(),
    acceptedContributionCents: z.number(),
    acceptedMarginBp: rate,
  }),
  deliveries: z.object({
    delivered: z.number(),
    withDeliveryWindow: z.number(),
    onTime: z.number(),
    onTimeRateBp: rate,
  }),
});

export type CommercialReport = z.infer<typeof commercialReportSchema>;

export const PERIODS = [
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "365", label: "Last 12 months", days: 365 },
] as const;

/** The first day of a period of `days` days that ends today (UTC date arithmetic on YYYY-MM-DD). */
export function periodStart(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (days - 1));
  return date.toISOString().slice(0, 10);
}
