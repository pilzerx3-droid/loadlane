import type { AuthDeps } from "./auth-routes";
import { getAuthDeps } from "./deps";

/**
 * Runs a route handler with the server-side dependencies. When the sign-in is not configured (missing
 * or invalid environment variables) it answers with `whenNotConfigured` instead of failing with a 500.
 */
export async function withAuthDeps(
  request: Request,
  handler: (request: Request, deps: AuthDeps) => Promise<Response>,
  whenNotConfigured: () => Response,
  getDeps: () => AuthDeps = getAuthDeps,
): Promise<Response> {
  let deps: AuthDeps;
  try {
    deps = getDeps();
  } catch (error) {
    console.error("Sign-in is not configured:", error instanceof Error ? error.message : error);
    return whenNotConfigured();
  }
  return handler(request, deps);
}

/** The start page explains what is missing, so unconfigured sign-in routes just lead there. */
export function redirectHome(): Response {
  return new Response(null, {
    status: 302,
    headers: { location: "/", "cache-control": "no-store" },
  });
}
