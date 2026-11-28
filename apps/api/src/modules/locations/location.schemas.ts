import { z } from "zod";
import {
  archivedField,
  directoryRecordFields,
  optionalText,
  requiredText,
} from "../../platform/directory-http.ts";
import { timeZoneField } from "../../platform/time-zone.ts";

const US_STATE = /^[A-Z]{2}$/;
const ZIP = /^\d{5}(-\d{4})?$/;

const timezoneField = timeZoneField("America/Denver").describe(
  "IANA time zone of the place. Appointment windows are read in it.",
);

const locationFields = {
  name: requiredText(120).describe("Name of the place, for example the warehouse or dock"),
  addressLine1: requiredText(200),
  addressLine2: optionalText(200),
  city: requiredText(100),
  state: z.string().trim().toUpperCase().regex(US_STATE, "must be a two-letter state code"),
  postalCode: z.string().trim().regex(ZIP, "must be a 5-digit ZIP code, optionally with +4"),
  timezone: timezoneField,
  notes: optionalText(2000),
};

export const createLocationSchema = z.strictObject(locationFields);
export const updateLocationSchema = z.strictObject({
  name: locationFields.name.optional(),
  addressLine1: locationFields.addressLine1.optional(),
  addressLine2: locationFields.addressLine2,
  city: locationFields.city.optional(),
  state: locationFields.state.optional(),
  postalCode: locationFields.postalCode.optional(),
  timezone: locationFields.timezone.optional(),
  notes: locationFields.notes,
  archived: archivedField,
});

export const locationSchema = z.object({
  ...directoryRecordFields,
  name: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  country: z.string(),
  timezone: z.string(),
  notes: z.string().nullable(),
  latitude: z.number().nullable().describe("Set by an address lookup or entered by a person"),
  longitude: z.number().nullable(),
  geocodedAt: z.iso.datetime().nullable(),
  geocodeSource: z.enum(["provider", "manual"]).nullable(),
});

export type LocationResponse = z.infer<typeof locationSchema>;
