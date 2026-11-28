"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieNames } from "../lib/cookies";
import { getAuthDeps } from "../lib/deps";
import { createTrackingLink, revokeTrackingLink } from "../lib/tracking-links";

// Server actions for customer tracking links. The API checks permission and organization again.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateTrackingState {
  /** The full link, shown once. Never put in a URL of this site or stored by the web app. */
  url?: string;
  expiresAt?: string;
  message?: string;
}

const MESSAGES = {
  closed: "A cancelled transport cannot get a tracking link.",
  forbidden: "You do not have permission to create tracking links.",
  not_found: "This transport no longer exists.",
  unavailable: "Loadlane could not create the link right now. Please try again in a moment.",
} as const;

async function currentSession() {
  const deps = getAuthDeps();
  const sessionId = (await cookies()).get(cookieNames(deps.config.secureCookies).session)?.value;
  return { deps, sessionId };
}

export async function createTrackingLinkAction(
  transportId: string,
  _previous: CreateTrackingState | undefined,
): Promise<CreateTrackingState> {
  void _previous; // the shape useActionState requires; each click starts from scratch
  if (!UUID_PATTERN.test(transportId)) redirect("/transports");
  const { deps, sessionId } = await currentSession();
  const result = await createTrackingLink(sessionId, transportId, deps);
  if (result.status === "signed_out") redirect("/");
  if (result.status === "created") return { url: result.url, expiresAt: result.expiresAt };
  return { message: MESSAGES[result.status] };
}

export async function revokeTrackingLinkAction(transportId: string, linkId: string): Promise<void> {
  if (!UUID_PATTERN.test(transportId) || !UUID_PATTERN.test(linkId)) redirect("/transports");
  const { deps, sessionId } = await currentSession();
  const result = await revokeTrackingLink(sessionId, linkId, deps);
  if (result === "signed_out") redirect("/");
  redirect(
    result === "done"
      ? `/transports/${transportId}`
      : `/transports/${transportId}?problem=driver_link_${result}`,
  );
}
