import { z } from "zod";

// The web app's side of the Driver Link API (ADR 0015). The token is the driver's only credential;
// it travels in a header, never in a URL we call, and is never logged.

export const driverJobSchema = z.object({
  reference: z.string(),
  status: z.string(),
  nextStatuses: z.array(z.string()),
  sharing: z.boolean(),
  consent: z.object({ acceptedAt: z.string(), withdrawnAt: z.string().nullable() }).nullable(),
  consentTextVersion: z.number().int(),
  stops: z.array(
    z.object({
      sequence: z.number().int(),
      type: z.enum(["pickup", "delivery"]),
      windowStart: z.string(),
      windowEnd: z.string(),
      reference: z.string().nullable(),
      notes: z.string().nullable(),
      location: z.object({
        name: z.string(),
        addressLine1: z.string(),
        addressLine2: z.string().nullable(),
        city: z.string(),
        state: z.string(),
        postalCode: z.string(),
        timezone: z.string(),
      }),
    }),
  ),
});

export type DriverJobView = z.infer<typeof driverJobSchema>;

export type DriverFailure =
  | "invalid"
  | "revoked"
  | "expired"
  | "consent_required"
  | "tracking_closed"
  | "conflict"
  | "rejected"
  | "unavailable";

export type DriverResult<T> = { ok: true; data: T } | { ok: false; reason: DriverFailure };

export const DRIVER_FAILURE_MESSAGES: Record<DriverFailure, string> = {
  invalid: "This link is not valid. Ask the dispatcher for a new one.",
  revoked: "This link was withdrawn. Ask the dispatcher for a new one.",
  expired: "This link has expired. Ask the dispatcher for a new one.",
  consent_required: "Position sharing is off. Agree below to share your position.",
  tracking_closed: "This transport is finished, so positions are no longer sent.",
  conflict: "That update is not possible right now. Reload the page to see the current status.",
  rejected: "Loadlane could not accept that. Please try again.",
  unavailable: "Loadlane could not be reached. Check your connection and try again.",
};

/** Calls the Driver Link API. `json` makes it a POST. Never throws: failures come back as a reason. */
export async function driverRequest<S extends z.ZodType>(options: {
  apiUrl: string;
  token: string;
  path: string;
  schema: S;
  json?: unknown;
  fetchFn?: typeof fetch;
}): Promise<DriverResult<z.output<S>>> {
  const { apiUrl, token, path, schema, json, fetchFn = fetch } = options;
  let response: Response;
  try {
    response = await fetchFn(`${apiUrl}/v1/driver/${path}`, {
      method: json === undefined ? "GET" : "POST",
      headers: {
        "x-driver-token": token,
        accept: "application/json",
        ...(json === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (response.ok) {
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, reason: "unavailable" };
  }
  const problem = (await response.json().catch(() => ({}))) as { code?: unknown };
  if (response.status === 404) return { ok: false, reason: "invalid" };
  if (response.status === 410) {
    return { ok: false, reason: problem.code === "driver_link_expired" ? "expired" : "revoked" };
  }
  if (response.status === 403 && problem.code === "consent_required") {
    return { ok: false, reason: "consent_required" };
  }
  if (response.status === 409) {
    return {
      ok: false,
      reason: problem.code === "tracking_closed" ? "tracking_closed" : "conflict",
    };
  }
  if (response.status === 400) return { ok: false, reason: "rejected" };
  return { ok: false, reason: "unavailable" };
}
