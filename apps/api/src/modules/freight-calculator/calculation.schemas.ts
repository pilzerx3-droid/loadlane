import { COST_KINDS } from "@loadlane/shared";
import { z } from "zod";

// All money in this API is whole US cents (`...Cents`) and all rates are basis points (`...Bp`,
// 100 bp = 1 %). Markup (on cost), margin (on price) and contribution (absolute) are separate
// pricing modes and are never converted into each other.

const cents = z.number().int().min(0).max(100_000_000_000);
const kind = z.enum(COST_KINDS);
const label = z.string().trim().min(1).max(120);

export const costLineInputSchema = z.union([
  z.strictObject({
    kind,
    label,
    amountCents: cents.describe("The amount of this line in cents"),
  }),
  z.strictObject({
    kind,
    label,
    rateCents: cents.describe("Price per unit in cents"),
    quantityThousandths: z
      .number()
      .int()
      .min(0)
      .max(1_000_000_000)
      .describe("Quantity in thousandths of the unit (412.5 miles = 412500)"),
    unit: z.string().trim().min(1).max(20),
  }),
]);

export const pricingInputSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("markup"),
    rateBp: z.number().int().min(0).max(1_000_000).describe("Markup on cost in basis points"),
  }),
  z.strictObject({
    mode: z.literal("margin"),
    rateBp: z.number().int().min(0).max(9_999).describe("Margin on price in basis points"),
  }),
  z.strictObject({ mode: z.literal("contribution"), amountCents: cents }),
  z.strictObject({ mode: z.literal("price"), amountCents: cents }),
]);

export const createCalculationSchema = z.strictObject({
  name: label.describe("A name to find the calculation again, for example the lane"),
  customerId: z.uuid().nullable().optional(),
  lines: z.array(costLineInputSchema).min(1).max(50),
  pricing: pricingInputSchema,
});

export const calculationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

const analysisSchema = z.object({
  costCents: z.number().int(),
  priceCents: z.number().int(),
  contributionCents: z.number().int().describe("price - cost, may be negative"),
  markupBp: z.number().int().nullable().describe("contribution / cost, null when the cost is 0"),
  marginBp: z.number().int().nullable().describe("contribution / price, null when the price is 0"),
});

export const calculationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  customer: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  pricingMode: z.enum(["markup", "margin", "contribution", "price"]),
  ...analysisSchema.shape,
  createdAt: z.iso.datetime(),
  createdBy: z.object({ id: z.uuid(), displayName: z.string() }),
});

export const calculationDetailSchema = calculationSummarySchema.extend({
  engineVersion: z.number().int(),
  lines: z.array(
    z.object({
      kind,
      label: z.string(),
      amountCents: z.number().int(),
      basis: z
        .object({
          rateCents: z.number().int(),
          quantityThousandths: z.number().int(),
          unit: z.string(),
        })
        .nullable()
        .describe("How the amount came about, when it came from a rate and a quantity"),
    }),
  ),
  costByKind: z.record(kind, z.number().int()),
  pricing: z.record(z.string(), z.union([z.string(), z.number()])),
});

export const calculationListSchema = z.object({
  items: z.array(calculationSummarySchema),
  page: z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int() }),
});

export type CreateCalculationInput = z.output<typeof createCalculationSchema>;
export type CalculationSummary = z.infer<typeof calculationSummarySchema>;
export type CalculationDetail = z.infer<typeof calculationDetailSchema>;
export type CalculationList = z.infer<typeof calculationListSchema>;
