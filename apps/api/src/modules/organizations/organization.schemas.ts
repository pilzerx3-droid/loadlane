import { z } from "zod";

export const organizationResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  region: z.enum(["us", "eu"]),
  distanceUnit: z.enum(["mi", "km"]),
  weightUnit: z.enum(["lb", "kg"]),
  currency: z.string().describe("ISO 4217 code"),
  locale: z.string(),
  timezone: z.string().describe("IANA time zone name"),
});

export type OrganizationResponse = z.infer<typeof organizationResponseSchema>;

/** The canonical IANA name of a time zone, or undefined when the runtime does not know it. */
export function canonicalTimeZone(value: string): string | undefined {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/**
 * Input for creating an organization. Region, units and currency are not accepted: new organizations
 * get the US defaults of ADR 0005 and EU hosting is not offered yet. Unknown fields are rejected.
 */
export const createOrganizationSchema = z.strictObject({
  name: z.string().trim().min(2).max(80).describe("Display name of the organization"),
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "must be lowercase letters and digits, separated by single hyphens",
    )
    .optional()
    .describe("Short unique name for URLs. Derived from the name when left out."),
  timezone: z
    .string()
    .transform((value, context) => {
      const canonical = canonicalTimeZone(value);
      if (canonical === undefined) {
        context.addIssue({
          code: "custom",
          message: "must be an IANA time zone, for example America/Chicago",
        });
        return z.NEVER;
      }
      return canonical;
    })
    .describe("IANA time zone of the organization, for example America/Chicago"),
});

export type CreateOrganizationInput = z.output<typeof createOrganizationSchema>;

/** A URL-safe short name from a display name: lowercase ASCII letters and digits separated by hyphens. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : "organization";
}
