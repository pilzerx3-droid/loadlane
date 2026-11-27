import { fetchMe, type Me } from "./api-client";
import { loadSession, type AuthDeps } from "./auth-routes";

/** What the start page shows. Computed on the server for every request. */
export type HomeState =
  | { kind: "signed_out" }
  | { kind: "signed_in"; me: Me }
  | {
      kind: "problem";
      problem: "email_not_verified" | "email_in_use" | "account_disabled" | "unavailable";
    };

export async function loadHome(
  sessionId: string | undefined,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<HomeState> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return { kind: "signed_out" };

  const result = await fetchMe(deps.config.apiUrl, session.accessToken, fetchFn);
  if (result.status === "ok") return { kind: "signed_in", me: result.me };
  if (result.status === "unauthorized") {
    // The API does not accept the token any more (for example the provider revoked it).
    await deps.store.destroySession(sessionId);
    return { kind: "signed_out" };
  }
  return { kind: "problem", problem: result.status };
}
