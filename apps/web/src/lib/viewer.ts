import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { OrganizationSummary } from "./api-client";
import { cookieNames } from "./cookies";
import { getAuthDeps } from "./deps";
import { resolveViewer, type Viewer, type ViewerResult } from "./viewer-core";

/**
 * Who is looking at this page. Computed once per request (React cache), so layout and page share the
 * same answer. A missing or invalid configuration is reported as its own state, not as a crash.
 */
export const getViewer = cache(async (): Promise<ViewerResult | "not_configured"> => {
  try {
    const deps = getAuthDeps();
    const sessionId = (await cookies()).get(cookieNames(deps.config.secureCookies).session)?.value;
    return await resolveViewer(sessionId, deps);
  } catch (error) {
    console.error(
      "Could not work out who is signed in:",
      error instanceof Error ? error.message : error,
    );
    // A setup problem is not temporary; everything else (for example Valkey down) is.
    return error instanceof Error && error.message.startsWith("Invalid web configuration")
      ? "not_configured"
      : { kind: "problem", problem: "unavailable" };
  }
});

export type ActiveViewer = Viewer & { active: OrganizationSummary };

/**
 * For pages that belong to an organization. Sends visitors who are signed out (or have a problem
 * the start page explains) to "/", and people without an organization to the onboarding page.
 * `allowed` says whether the person's roles include `permission`; the page then shows a notice
 * instead of its content. The API checks the permission again on every call.
 */
export async function requireOrganizationPage(
  permission?: string,
): Promise<{ viewer: ActiveViewer; allowed: boolean }> {
  const result = await getViewer();
  if (result === "not_configured" || result.kind !== "ok") redirect("/");
  const { viewer } = result;
  if (!viewer.active) redirect("/onboarding");
  return {
    viewer: { ...viewer, active: viewer.active },
    allowed: permission === undefined || viewer.active.permissions.includes(permission),
  };
}
