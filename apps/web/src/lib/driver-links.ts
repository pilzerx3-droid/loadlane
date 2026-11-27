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
  consent: z.object({ acceptedAt: z.string(), withdrawnAt: z.string().nullable() }).nullable(),
});

export const driverLinkListSchema = z.object({ items: z.array(summarySchema) });
export const createdDriverLinkSchema = summarySchema.extend({ token: z.string() });

export type DriverLinkItem = z.infer<typeof summarySchema>;

export type CreateLinkResult =
  | { status: "created"; url: string; expiresAt: string }
  | { status: "closed" | "forbidden" | "not_found" | "signed_out" | "unavailable" };

/** The address the driver opens. The token is part of the path and is shown to the dispatcher once. */
export function driverLinkUrl(appOrigin: string, token: string): string {
  return `${appOrigin}/d/${encodeURIComponent(token)}`;
}

export async function createDriverLink(
  sessionId: string | undefined,
  transportId: string,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<CreateLinkResult> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return { status: "signed_out" };
  const organizationId = session.activeOrganizationId;
  if (!organizationId) return { status: "forbidden" };
  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    organizationId,
    path: `/v1/transports/${transportId}/driver-links`,
    json: {},
    schema: createdDriverLinkSchema,
    fetchFn,
  });
  if (result.ok) {
    return {
      status: "created",
      url: driverLinkUrl(deps.config.appUrl.origin, result.data.token),
      expiresAt: result.data.expiresAt,
    };
  }
  if (result.status === 401) return { status: "signed_out" };
  if (result.status === 403) return { status: "forbidden" };
  if (result.status === 404) return { status: "not_found" };
  if (result.status === 409) return { status: "closed" };
  deps.log(`Creating a driver link failed with HTTP ${result.status}`);
  return { status: "unavailable" };
}

export async function revokeDriverLink(
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
    path: `/v1/driver-links/${linkId}/revoke`,
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
