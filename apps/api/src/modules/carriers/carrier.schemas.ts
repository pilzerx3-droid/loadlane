import { z } from "zod";
import {
  archivedField,
  directoryRecordFields,
  optionalEmail,
  optionalText,
  requiredText,
} from "../../platform/directory-http.ts";

const carrierFields = {
  name: requiredText(120).describe("Company name. Unique among active carriers, ignoring case."),
  mcNumber: optionalText(20).describe("Motor carrier (MC) number as typed. Not verified."),
  dotNumber: optionalText(20).describe("USDOT number as typed. Not verified."),
  contactName: optionalText(120),
  contactEmail: optionalEmail(),
  contactPhone: optionalText(40),
  notes: optionalText(2000),
};

export const createCarrierSchema = z.strictObject(carrierFields);
export const updateCarrierSchema = z.strictObject({
  ...carrierFields,
  name: carrierFields.name.optional(),
  archived: archivedField,
});

export const carrierSchema = z.object({
  ...directoryRecordFields,
  name: z.string(),
  mcNumber: z.string().nullable(),
  dotNumber: z.string().nullable(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  notes: z.string().nullable(),
});

export type CarrierResponse = z.infer<typeof carrierSchema>;
