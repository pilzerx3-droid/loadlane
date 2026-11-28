import { z } from "zod";
import { apiRequest } from "./api-client";
import { loadSession, type AuthDeps } from "./auth-routes";

const summarySchema = z.object({
  id: z.string(),
  transportId: z.string(),
  state: z.enum(["active", "expired", "revoked"]),
  expiresAt: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
  createdBy: z.object({ id: z.string(), displayName: z.string() }),
});

export const trackingLinkListSchema = z.object({ items: z.array(summarySchema) });
export const createdTrackingLinkSchema = summarySchema.extend({ token: z.string() });
export type TrackingLinkItem = z.infer<typeof summarySchema>;

export const publicTrackingSchema = z.object({
  reference: z.string(),
  customerReference: z.string().nullable(),
  status: z.string(),
  stops: z.array(
    z.object({
      sequence: z.number(),
      type: z.enum(["pickup", "delivery"]),
      placeName: z.string(),
      city: z.string(),
      state: z.string(),
      windowStart: z.string(),
      windowEnd: z.string(),
      timezone: z.string(),
    }),
  ),
  history: z.array(z.object({ status: z.string(), occurredAt: z.string() })),
});
export type PublicTracking = z.infer<typeof publicTrackingSchema>;

export type CreateTrackingResult =
  | { status: "created"; url: string; expiresAt: string }
  | { status: "closed" | "forbidden" | "not_found" | "signed_out" | "unavailable" };

export function trackingUrl(appOrigin: string, token: string): string {
  return `${appOrigin}/t/${encodeURIComponent(token)}`;
}

export async function createTrackingLink(
  sessionId: string | undefined,
  transportId: string,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<CreateTrackingResult> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return { status: "signed_out" };
  const organizationId = session.activeOrganizationId;
  if (!organizationId) return { status: "forbidden" };
  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    organizationId,
    path: `/v1/transports/${transportId}/tracking-links`,
    json: {},
    schema: createdTrackingLinkSchema,
    fetchFn,
  });
  if (result.ok) {
    return {
      status: "created",
      url: trackingUrl(deps.config.appUrl.origin, result.data.token),
      expiresAt: result.data.expiresAt,
    };
  }
  if (result.status === 401) return { status: "signed_out" };
  if (result.status === 403) return { status: "forbidden" };
  if (result.status === 404) return { status: "not_found" };
  if (result.status === 409) return { status: "closed" };
  deps.log(`Creating a tracking link failed with HTTP ${result.status}`);
  return { status: "unavailable" };
}

export async function revokeTrackingLink(
  sessionId: string | undefined,
  linkId: string,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<"done" | "forbidden" | "not_found" | "signed_out" | "unavailable"> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return "signed_out";
  const organizationId = session.activeOrganizationId;
  if (!organizationId) return "forbidden";
  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    organizationId,
    path: `/v1/tracking-links/${linkId}/revoke`,
    json: {},
    schema: summarySchema,
    fetchFn,
  });
  if (result.ok) return "done";
  if (result.status === 401) return "signed_out";
  if (result.status === 403) return "forbidden";
  if (result.status === 404) return "not_found";
  return "unavailable";
}

export type PublicTrackingResult =
  { ok: true; data: PublicTracking } | { ok: false; reason: "invalid" | "gone" | "unavailable" };

/** Reads the customer's view. The token goes in a header, never in the API address. */
export async function fetchPublicTracking(
  apiUrl: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<PublicTrackingResult> {
  let response: Response;
  try {
    response = await fetchFn(`${apiUrl}/v1/tracking/view`, {
      headers: { "x-tracking-token": token, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (response.ok) {
    const parsed = publicTrackingSchema.safeParse(await response.json().catch(() => undefined));
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, reason: "unavailable" };
  }
  if (response.status === 404) return { ok: false, reason: "invalid" };
  if (response.status === 410) return { ok: false, reason: "gone" };
  return { ok: false, reason: "unavailable" };
}
