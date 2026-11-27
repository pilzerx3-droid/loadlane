import { apiRequest, fetchMe, organizationDetailSchema } from "./api-client";
import { loadSession, type AuthDeps } from "./auth-routes";
import type { SessionData } from "./session-store";

export type SwitchResult = "switched" | "not_a_member" | "signed_out" | "unavailable";

/** Makes `organizationId` the active organization, but only if the API says the person belongs to it. */
export async function switchOrganization(
  sessionId: string | undefined,
  organizationId: string,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<SwitchResult> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return "signed_out";

  const me = await fetchMe(deps.config.apiUrl, session.accessToken, fetchFn);
  if (me.status === "unauthorized") return "signed_out";
  if (me.status !== "ok") return "unavailable";
  if (!me.me.organizations.some((organization) => organization.id === organizationId)) {
    return "not_a_member";
  }
  await deps.store.updateSession(sessionId, { ...session, activeOrganizationId: organizationId });
  return "switched";
}

export interface CreateOrganizationInput {
  name: string;
  timezone: string;
}

export type CreateOrganizationResult =
  | { status: "created"; organizationId: string }
  | { status: "invalid"; fieldErrors: { name?: string; timezone?: string } }
  | { status: "slug_taken" | "organization_limit_reached" | "signed_out" | "unavailable" };

/** Creates an organization through the API and makes it the active one. */
export async function createOrganization(
  sessionId: string | undefined,
  input: CreateOrganizationInput,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<CreateOrganizationResult> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return { status: "signed_out" };

  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    path: "/v1/organizations",
    schema: organizationDetailSchema,
    json: input,
    fetchFn,
  });
  if (result.ok) {
    const updated: SessionData = { ...session, activeOrganizationId: result.data.id };
    await deps.store.updateSession(sessionId, updated);
    return { status: "created", organizationId: result.data.id };
  }

  if (result.status === 401) return { status: "signed_out" };
  if (result.code === "validation_failed") {
    const fieldErrors: { name?: string; timezone?: string } = {};
    for (const error of result.errors) {
      if (error.path === "name") fieldErrors.name ??= error.message;
      if (error.path === "timezone") fieldErrors.timezone ??= error.message;
    }
    return { status: "invalid", fieldErrors };
  }
  if (result.code === "slug_taken" || result.code === "organization_limit_reached") {
    return { status: result.code };
  }
  deps.log(`Creating an organization failed with HTTP ${result.status} (${result.code})`);
  return { status: "unavailable" };
}
