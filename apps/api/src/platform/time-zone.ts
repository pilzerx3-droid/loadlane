import { z } from "zod";

/** The canonical IANA name of a time zone, or undefined when the runtime does not know it. */
export function canonicalTimeZone(value: string): string | undefined {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** Zod field for an IANA time zone. The output is the canonical name. */
export function timeZoneField(example: string) {
  return z.string().transform((value, context) => {
    const canonical = canonicalTimeZone(value);
    if (canonical === undefined) {
      context.addIssue({
        code: "custom",
        message: `must be an IANA time zone, for example ${example}`,
      });
      return z.NEVER;
    }
    return canonical;
  });
}
