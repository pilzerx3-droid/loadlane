"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createApiKey, revokeApiKey } from "../lib/api-keys";
import { cookieNames } from "../lib/cookies";
import { getAuthDeps } from "../lib/deps";

// Server actions for API keys. The API checks that the person is an administrator.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateKeyState {
  /** The full key, shown once. Never put in a URL of this site or stored by the web app. */
  key?: string;
  message?: string;
}

const MESSAGES = {
  invalid: "Give the key a name and choose at least one permission.",
  forbidden: "Only administrators can create API keys.",
  unavailable: "Loadlane could not create the key right now. Please try again in a moment.",
} as const;

async function currentSession() {
  const deps = getAuthDeps();
  const sessionId = (await cookies()).get(cookieNames(deps.config.secureCookies).session)?.value;
  return { deps, sessionId };
}

export async function createApiKeyAction(
  _previous: CreateKeyState | undefined,
  formData: FormData,
): Promise<CreateKeyState> {
  void _previous; // the shape useActionState requires
  const nameValue = formData.get("name");
  const name = typeof nameValue === "string" ? nameValue.trim() : "";
  const scopes = formData
    .getAll("scope")
    .filter((value): value is string => typeof value === "string");
  if (name === "" || scopes.length === 0) return { message: MESSAGES.invalid };
  const { deps, sessionId } = await currentSession();
  const result = await createApiKey(sessionId, name, scopes, deps);
  if (result.status === "signed_out") redirect("/");
  if (result.status === "created") return { key: result.key };
  return { message: MESSAGES[result.status] };
}

export async function revokeApiKeyAction(id: string): Promise<void> {
  if (!UUID_PATTERN.test(id)) redirect("/integrations");
  const { deps, sessionId } = await currentSession();
  const result = await revokeApiKey(sessionId, id, deps);
  if (result === "signed_out") redirect("/");
  redirect("/integrations");
}
