import { QUOTE_STATUSES } from "@loadlane/shared";
import { z } from "zod";
import { optionalText } from "../../platform/directory-http.ts";

const status = z.enum(QUOTE_STATUSES);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use the format YYYY-MM-DD");

export const createQuoteSchema = z.strictObject({
  calculationId: z.uuid().describe("The frozen calculation whose price is offered"),
  customerId: z
    .uuid()
    .optional()
    .describe("Required when the calculation has no customer; otherwise it must match"),
  validUntil: day.describe("Last day the offer is valid, in the organization's time zone"),
  terms: optionalText(5000).describe(
    "Terms shown to the customer. Written by the user, never generated.",
  ),
  notes: optionalText(2000).describe("Internal notes"),
});

export const updateQuoteSchema = z.strictObject({
  validUntil: day.optional(),
  terms: optionalText(5000),
  notes: optionalText(2000),
});

export const quoteStatusBodySchema = z.strictObject({ status });

export const quoteListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  status: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(",") : undefined))
    .pipe(z.array(status).optional())
    .describe("Comma separated statuses"),
});

export const quoteSummarySchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  reference: z.string(),
  status,
  expired: z.boolean().describe("Sent and past its last valid day. Derived, never stored."),
  customer: z.object({ id: z.uuid(), name: z.string() }),
  calculationName: z.string(),
  priceCents: z.number().int(),
  validUntil: day,
  createdAt: z.iso.datetime(),
});

export const quoteDetailSchema = quoteSummarySchema.extend({
  allowedStatuses: z.array(status),
  editable: z.boolean(),
  terms: z.string().nullable(),
  notes: z.string().nullable(),
  sentAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  createdBy: z.object({ id: z.uuid(), displayName: z.string() }),
  calculation: z.object({
    id: z.uuid(),
    costCents: z.number().int(),
    contributionCents: z.number().int(),
    markupBp: z.number().int().nullable(),
    marginBp: z.number().int().nullable(),
  }),
});

export const quoteListSchema = z.object({
  items: z.array(quoteSummarySchema),
  page: z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int() }),
});

export type CreateQuoteInput = z.output<typeof createQuoteSchema>;
export type UpdateQuoteInput = z.output<typeof updateQuoteSchema>;
export type QuoteListQuery = z.output<typeof quoteListQuerySchema>;
export type QuoteSummary = z.infer<typeof quoteSummarySchema>;
export type QuoteDetail = z.infer<typeof quoteDetailSchema>;
export type QuoteList = z.infer<typeof quoteListSchema>;
