import { COST_KINDS, TARIFF_UNITS } from "@loadlane/shared";
import { z } from "zod";
import { optionalText } from "../../platform/directory-http.ts";

// Money is whole US cents (`...Cents`). A tariff version is a list of rate lines; it is never
// edited: a change is a new version with its own start date.

const cents = z.number().int().min(0).max(1_000_000_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use the format YYYY-MM-DD");

export const tariffLineSchema = z.strictObject({
  kind: z.enum(COST_KINDS),
  label: z.string().trim().min(1).max(120),
  unit: z.enum(TARIFF_UNITS),
  rateCents: cents.describe("Price per unit in cents"),
  minimumCents: cents.optional().describe("The line is never less than this, in cents"),
});

const linesSchema = z.array(tariffLineSchema).min(1).max(50);

export const createTariffSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  kind: z
    .enum(["sell", "buy"])
    .describe("sell: what a customer pays us; buy: what we pay a carrier"),
  customerId: z
    .uuid()
    .optional()
    .describe("For sell tariffs: the customer it belongs to (optional)"),
  carrierId: z.uuid().optional().describe("For buy tariffs: the carrier it belongs to (optional)"),
  validFrom: day.describe("First day the first version is in force"),
  note: optionalText(500),
  lines: linesSchema,
});

export const newVersionSchema = z.strictObject({
  validFrom: day,
  note: optionalText(500),
  lines: linesSchema,
});

export const applySchema = z.strictObject({
  date: day.describe("The shipment date: the version in force on this day is used"),
  quantities: z
    .strictObject({
      mile: z.number().min(0).max(1_000_000).optional(),
      pallet: z.number().min(0).max(1_000_000).optional(),
      lb: z.number().min(0).max(100_000_000).optional(),
      hour: z.number().min(0).max(100_000).optional(),
    })
    .describe("Quantities by unit, for example 412.5 miles. Units a line needs must be given."),
});

export const tariffListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  kind: z.enum(["sell", "buy"]).optional(),
  archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

const lineOut = z.object({
  kind: z.enum(COST_KINDS),
  label: z.string(),
  unit: z.enum(TARIFF_UNITS),
  rateCents: z.number().int(),
  minimumCents: z.number().int().nullable(),
});

const versionOut = z.object({
  id: z.uuid(),
  version: z.number().int(),
  validFrom: day,
  note: z.string().nullable(),
  lines: z.array(lineOut),
  createdAt: z.iso.datetime(),
  createdBy: z.object({ id: z.uuid(), displayName: z.string() }),
});

export const tariffSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(["sell", "buy"]),
  party: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  archived: z.boolean(),
  versions: z.number().int(),
  latestValidFrom: day.nullable(),
  createdAt: z.iso.datetime(),
});

export const tariffDetailSchema = tariffSummarySchema.extend({
  currentVersion: versionOut.nullable().describe("The version in force today, if any"),
  allVersions: z.array(versionOut).describe("Newest first"),
});

export const tariffListSchema = z.object({
  items: z.array(tariffSummarySchema),
  page: z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int() }),
});

export const applyResultSchema = z.object({
  tariffId: z.uuid(),
  tariffName: z.string(),
  versionId: z.uuid(),
  version: z.number().int(),
  validFrom: day,
  lines: z.array(
    z.object({
      kind: z.enum(COST_KINDS),
      label: z.string(),
      amountCents: z.number().int(),
      minimumApplied: z.boolean(),
      basis: z
        .object({
          rateCents: z.number().int(),
          quantityThousandths: z.number().int(),
          unit: z.string(),
        })
        .nullable(),
    }),
  ),
  totalCents: z.number().int(),
});

export type CreateTariffInput = z.output<typeof createTariffSchema>;
export type NewVersionInput = z.output<typeof newVersionSchema>;
export type ApplyInput = z.output<typeof applySchema>;
export type TariffListQuery = z.output<typeof tariffListQuerySchema>;
export type TariffSummary = z.infer<typeof tariffSummarySchema>;
export type TariffDetail = z.infer<typeof tariffDetailSchema>;
export type TariffList = z.infer<typeof tariffListSchema>;
export type ApplyResultOut = z.infer<typeof applyResultSchema>;
