import { z } from "zod";

/** Query parameters of every master-data list: paging, a text search and whether archived records are included. */
export const directoryListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50).describe("Page size"),
  offset: z.coerce.number().int().min(0).default(0).describe("Number of entries to skip"),
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Case-insensitive text search over the main fields"),
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true")
    .describe("Also list archived records"),
});

export type DirectoryListQueryInput = z.output<typeof directoryListQuerySchema>;

export function directoryListResponseSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.object({
      limit: z.number().int(),
      offset: z.number().int(),
      total: z.number().int().describe("Records matching the filter"),
    }),
  });
}

/** Fields every master-data record carries in responses. */
export const directoryRecordFields = {
  id: z.uuid(),
  archivedAt: z.iso.datetime().nullable().describe("Set when the record is archived"),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

/**
 * Optional text field. Surrounding blanks are removed and an empty string means "no value" (null),
 * so a form can clear a field by sending nothing. `null` clears it explicitly.
 */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();
}

export function optionalEmail() {
  return z
    .string()
    .trim()
    .max(254)
    .transform((value) => (value === "" ? null : value))
    .pipe(z.email().nullable())
    .nullable()
    .optional();
}

/** Required text field with surrounding blanks removed. */
export function requiredText(max: number) {
  return z.string().trim().min(1).max(max);
}

export const archivedField = z.boolean().optional().describe("true archives, false restores");

export const idParamSchema = z.uuid();
