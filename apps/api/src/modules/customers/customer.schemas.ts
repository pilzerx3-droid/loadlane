import { z } from "zod";
import {
  archivedField,
  directoryRecordFields,
  optionalEmail,
  optionalText,
  requiredText,
} from "../../platform/directory-http.ts";

const customerFields = {
  name: requiredText(120).describe("Company name. Unique among active customers, ignoring case."),
  contactName: optionalText(120),
  contactEmail: optionalEmail(),
  contactPhone: optionalText(40),
  notes: optionalText(2000),
};

export const createCustomerSchema = z.strictObject(customerFields);
export const updateCustomerSchema = z.strictObject({
  ...customerFields,
  name: customerFields.name.optional(),
  archived: archivedField,
});

export const customerSchema = z.object({
  ...directoryRecordFields,
  name: z.string(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  notes: z.string().nullable(),
});

export type CustomerResponse = z.infer<typeof customerSchema>;
