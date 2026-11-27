"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieNames } from "../lib/cookies";
import { getAuthDeps } from "../lib/deps";
import { inputFromForm, isMasterDataKey, MASTER_DATA } from "../lib/master-data";
import { saveRecord, setArchived } from "../lib/master-data-actions";

// Server actions for customers, carriers and locations. Next.js checks that the request comes from
// this site. The API checks the permission again for every call.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SaveRecordState {
  values: Record<string, string>;
  fieldErrors: Record<string, string>;
  message?: string;
}

const MESSAGES = {
  name_taken:
    "An active record with this name already exists. Use a different name or archive the other one first.",
  forbidden: "You do not have permission to change this.",
  not_found: "This record no longer exists.",
  unavailable: "Loadlane could not save this right now. Please try again in a moment.",
} as const;

async function currentSession() {
  const deps = getAuthDeps();
  const sessionId = (await cookies()).get(cookieNames(deps.config.secureCookies).session)?.value;
  return { deps, sessionId };
}

/** Saves the form of a record. `id` is empty for a new one. On success the person returns to the list. */
export async function saveRecordAction(
  kind: string,
  id: string,
  _previous: SaveRecordState | undefined,
  formData: FormData,
): Promise<SaveRecordState> {
  if (!isMasterDataKey(kind) || (id !== "" && !UUID_PATTERN.test(id))) redirect("/");
  const config = MASTER_DATA[kind];
  const values = inputFromForm(config, formData);
  const { deps, sessionId } = await currentSession();
  const result = await saveRecord(sessionId, kind, id === "" ? undefined : id, values, deps);

  if (result.status === "saved" || result.status === "signed_out") redirect(config.path);
  if (result.status === "invalid") return { values, fieldErrors: result.fieldErrors };
  return { values, fieldErrors: {}, message: MESSAGES[result.status] };
}

/** Archives or restores a record from a button. Returns to the record's page. */
export async function setArchivedAction(
  kind: string,
  id: string,
  archived: boolean,
): Promise<void> {
  if (!isMasterDataKey(kind) || !UUID_PATTERN.test(id)) redirect("/");
  const { deps, sessionId } = await currentSession();
  await setArchived(sessionId, kind, id, archived, deps);
  redirect(archived ? MASTER_DATA[kind].path : `${MASTER_DATA[kind].path}/${id}`);
}
