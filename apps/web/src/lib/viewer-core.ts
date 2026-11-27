import { fetchMe, type Me, type OrganizationSummary } from "./api-client";
import { loadSession, type AuthDeps } from "./auth-routes";
import type { SessionData } from "./session-store";

export type ViewerProblem =
  "email_not_verified" | "email_in_use" | "account_disabled" | "unavailable";

/** The signed-in person with the organizations they belong to and the one they are working in. */
export interface Viewer {
  sessionId: string;
  accessToken: string;
  user: Me["user"];
  organizations: OrganizationSummary[];
  /** Undefined when the person belongs to no organization yet. */
  active: OrganizationSummary | undefined;
}

export type ViewerResult =
  | { kind: "signed_out" }
  | { kind: "problem"; problem: ViewerProblem }
  | { kind: "ok"; viewer: Viewer };

/** The remembered organization if the person still belongs to it, otherwise the first one. */
export function pickActiveOrganization(
  organizations: readonly OrganizationSummary[],
  preferredId: string | undefined,
): OrganizationSummary | undefined {
  return organizations.find((organization) => organization.id === preferredId) ?? organizations[0];
}

/**
 * Works out who is looking at the page: loads the session (renewing the access token when needed),
 * asks the API who the person is and which organizations they belong to, and settles which
 * organization is active. The remembered choice is checked against the API on every page, so a person
 * who was removed from an organization cannot keep working in it.
 */
export async function resolveViewer(
  sessionId: string | undefined,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<ViewerResult> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return { kind: "signed_out" };

  const result = await fetchMe(deps.config.apiUrl, session.accessToken, fetchFn);
  if (result.status === "unauthorized") {
    // The API does not accept the token any more (for example the provider revoked it).
    await deps.store.destroySession(sessionId);
    return { kind: "signed_out" };
  }
  if (result.status !== "ok") return { kind: "problem", problem: result.status };

  const { me } = result;
  const active = pickActiveOrganization(me.organizations, session.activeOrganizationId);
  if (active?.id !== session.activeOrganizationId) {
    const updated: SessionData = { ...session };
    if (active) updated.activeOrganizationId = active.id;
    else delete updated.activeOrganizationId;
    await deps.store.updateSession(sessionId, updated);
  }
  return {
    kind: "ok",
    viewer: {
      sessionId,
      accessToken: session.accessToken,
      user: me.user,
      organizations: me.organizations,
      active,
    },
  };
}
