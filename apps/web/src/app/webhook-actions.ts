"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieNames } from "../lib/cookies";
import { getAuthDeps } from "../lib/deps";
import { createWebhook, disableWebhook } from "../lib/webhooks";

// Server actions for webhook endpoints. The API checks the permission and the address again.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateWebhookState {
  /** The signing secret, shown once. Never put in a URL of this site or stored by the web app. */
  secret?: string;
  message?: string;
}

const MESSAGES = {
  invalid: "Enter a full https address, for example https://example.com/loadlane-events.",
  not_configured: "Webhooks are not set up on this server yet (no WEBHOOK_ENCRYPTION_KEY).",
  forbidden: "Only administrators can add webhooks.",
  unavailable: "Loadlane could not save this right now. Please try again in a moment.",
} as const;

async function currentSession() {
  const deps = getAuthDeps();
  const sessionId = (await cookies()).get(cookieNames(deps.config.secureCookies).session)?.value;
  return { deps, sessionId };
}

export async function createWebhookAction(
  _previous: CreateWebhookState | undefined,
  formData: FormData,
): Promise<CreateWebhookState> {
  void _previous; // the shape useActionState requires
  const value = formData.get("url");
  const url = typeof value === "string" ? value.trim() : "";
  if (url === "") return { message: MESSAGES.invalid };
  const { deps, sessionId } = await currentSession();
  const result = await createWebhook(sessionId, url, deps);
  if (result.status === "signed_out") redirect("/");
  if (result.status === "created") return { secret: result.secret };
  return { message: MESSAGES[result.status] };
}

export async function disableWebhookAction(id: string): Promise<void> {
  if (!UUID_PATTERN.test(id)) redirect("/integrations");
  const { deps, sessionId } = await currentSession();
  const result = await disableWebhook(sessionId, id, deps);
  if (result === "signed_out") redirect("/");
  redirect("/integrations");
}
