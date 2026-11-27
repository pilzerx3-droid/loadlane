"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieNames } from "../lib/cookies";
import { getAuthDeps } from "../lib/deps";
import { createOrganization, switchOrganization } from "../lib/organization-actions";

// Server actions: Next.js checks that the request comes from this site (Origin against Host), which
// is the protection against forged cross-site form posts.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function currentSession() {
  const deps = getAuthDeps();
  const sessionId = (await cookies()).get(cookieNames(deps.config.secureCookies).session)?.value;
  return { deps, sessionId };
}

/** Makes another organization the active one. Always ends on the start page. */
export async function switchOrganizationAction(formData: FormData): Promise<void> {
  const organizationId = formData.get("organizationId");
  if (typeof organizationId === "string" && UUID_PATTERN.test(organizationId)) {
    const { deps, sessionId } = await currentSession();
    await switchOrganization(sessionId, organizationId.toLowerCase(), deps);
  }
  redirect("/");
}

export interface CreateOrganizationState {
  values: { name: string; timezone: string };
  fieldErrors: { name?: string; timezone?: string };
  /** A problem that belongs to no single field. */
  message?: string;
}

const MESSAGES = {
  slug_taken: "That name is taken. Please try a slightly different name.",
  organization_limit_reached:
    "You have reached the limit of organizations you can create. Contact support if you need more.",
  unavailable:
    "Loadlane could not create the organization right now. Please try again in a moment.",
} as const;

function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Creates the organization from the onboarding form. On success the person lands on the start page. */
export async function createOrganizationAction(
  _previous: CreateOrganizationState | undefined,
  formData: FormData,
): Promise<CreateOrganizationState> {
  const values = {
    name: formText(formData, "name").trim(),
    timezone: formText(formData, "timezone"),
  };
  const { deps, sessionId } = await currentSession();
  const result = await createOrganization(sessionId, values, deps);

  if (result.status === "created" || result.status === "signed_out") redirect("/");
  if (result.status === "invalid") return { values, fieldErrors: result.fieldErrors };
  return { values, fieldErrors: {}, message: MESSAGES[result.status] };
}
