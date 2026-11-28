import { z } from "zod";
import { apiRequest } from "./api-client";
import { loadSession, type AuthDeps } from "./auth-routes";

export const webhookSummarySchema = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  state: z.enum(["active", "disabled"]),
  createdAt: z.string(),
  disabledAt: z.string().nullable(),
  createdBy: z.object({ id: z.string(), displayName: z.string() }),
  pending: z.number(),
  failed: z.number(),
});
export const webhookListSchema = z.object({ items: z.array(webhookSummarySchema) });
export const createdWebhookSchema = webhookSummarySchema.extend({ secret: z.string() });
export type WebhookSummary = z.infer<typeof webhookSummarySchema>;

export type CreateWebhookResult =
  | { status: "created"; secret: string }
  | { status: "invalid" | "not_configured" | "forbidden" | "signed_out" | "unavailable" };

export async function createWebhook(
  sessionId: string | undefined,
  url: string,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<CreateWebhookResult> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return { status: "signed_out" };
  if (!session.activeOrganizationId) return { status: "forbidden" };
  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    organizationId: session.activeOrganizationId,
    path: "/v1/webhooks",
    json: { url },
    schema: createdWebhookSchema,
    fetchFn,
  });
  if (result.ok) return { status: "created", secret: result.data.secret };
  if (result.status === 401) return { status: "signed_out" };
  if (result.status === 403) return { status: "forbidden" };
  if (result.status === 400) return { status: "invalid" };
  if (result.status === 503 && result.code === "webhooks_not_configured") {
    return { status: "not_configured" };
  }
  deps.log(`Creating a webhook failed with HTTP ${result.status}`);
  return { status: "unavailable" };
}

export async function disableWebhook(
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
    path: `/v1/webhooks/${id}/disable`,
    json: {},
    schema: webhookSummarySchema,
    fetchFn,
  });
  if (result.ok) return "done";
  if (result.status === 401) return "signed_out";
  if (result.status === 403) return "forbidden";
  if (result.status === 404) return "not_found";
  return "unavailable";
}
