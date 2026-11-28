import { z } from "zod";
import { apiRequest } from "./api-client";
import { loadSession, type AuthDeps } from "./auth-routes";

export const SCOPE_LABELS = {
  "lookup:read": "Look up customers, carriers and locations",
  "transport:write": "Create transports",
} as const;

export type Scope = keyof typeof SCOPE_LABELS;

export const keySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  state: z.enum(["active", "revoked"]),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdBy: z.object({ id: z.string(), displayName: z.string() }),
});

export const keyListSchema = z.object({ items: z.array(keySummarySchema) });
export const createdKeySchema = keySummarySchema.extend({ key: z.string() });
export type KeySummary = z.infer<typeof keySummarySchema>;

export type CreateKeyResult =
  | { status: "created"; key: string; prefix: string }
  | { status: "invalid" | "forbidden" | "signed_out" | "unavailable" };

export async function createApiKey(
  sessionId: string | undefined,
  name: string,
  scopes: string[],
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<CreateKeyResult> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return { status: "signed_out" };
  if (!session.activeOrganizationId) return { status: "forbidden" };
  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    organizationId: session.activeOrganizationId,
    path: "/v1/api-keys",
    json: { name, scopes },
    schema: createdKeySchema,
    fetchFn,
  });
  if (result.ok) return { status: "created", key: result.data.key, prefix: result.data.prefix };
  if (result.status === 401) return { status: "signed_out" };
  if (result.status === 403) return { status: "forbidden" };
  if (result.status === 400) return { status: "invalid" };
  deps.log(`Creating an API key failed with HTTP ${result.status}`);
  return { status: "unavailable" };
}

export async function revokeApiKey(
  sessionId: string | undefined,
  id: string,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<"done" | "forbidden" | "not_found" | "signed_out" | "unavailable"> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return "signed_out";
  if (!session.activeOrganizationId) return "forbidden";
  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    organizationId: session.activeOrganizationId,
    path: `/v1/api-keys/${id}/revoke`,
    json: {},
    schema: keySummarySchema,
    fetchFn,
  });
  if (result.ok) return "done";
  if (result.status === 401) return "signed_out";
  if (result.status === 403) return "forbidden";
  if (result.status === 404) return "not_found";
  return "unavailable";
}
