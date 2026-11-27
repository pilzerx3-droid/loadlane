import { z } from "zod";
import { apiRequest } from "./api-client";
import { loadSession, type AuthDeps } from "./auth-routes";
import { MASTER_DATA, type MasterDataKey } from "./master-data";

/** The API's record, read loosely: the form only needs the values of the fields it knows. */
export const recordSchema = z.looseObject({ id: z.string() });

export type SaveResult =
  | { status: "saved"; id: string }
  | { status: "invalid"; fieldErrors: Record<string, string> }
  | { status: "name_taken" | "forbidden" | "not_found" | "signed_out" | "unavailable" };

function fieldErrorsOf(errors: { path: string; message: string }[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const error of errors) fieldErrors[error.path] ??= error.message;
  return fieldErrors;
}

/** Creates (`id` undefined) or changes a record of the active organization. */
export async function saveRecord(
  sessionId: string | undefined,
  kind: MasterDataKey,
  id: string | undefined,
  input: Record<string, string>,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<SaveResult> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return { status: "signed_out" };
  const organizationId = session.activeOrganizationId;
  if (!organizationId) return { status: "forbidden" };

  const config = MASTER_DATA[kind];
  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    organizationId,
    path: id === undefined ? `/v1${config.path}` : `/v1${config.path}/${id}`,
    method: id === undefined ? "POST" : "PATCH",
    json: input,
    schema: recordSchema,
    fetchFn,
  });
  if (result.ok) return { status: "saved", id: result.data.id };
  if (result.status === 401) return { status: "signed_out" };
  if (result.status === 403) return { status: "forbidden" };
  if (result.status === 404) return { status: "not_found" };
  if (result.code === "validation_failed") {
    return { status: "invalid", fieldErrors: fieldErrorsOf(result.errors) };
  }
  if (result.code === "name_taken") return { status: "name_taken" };
  deps.log(`Saving a ${kind} record failed with HTTP ${result.status} (${result.code})`);
  return { status: "unavailable" };
}

export type ArchiveResult =
  "done" | "forbidden" | "not_found" | "signed_out" | "unavailable" | "name_taken";

/** Archives or restores a record. */
export async function setArchived(
  sessionId: string | undefined,
  kind: MasterDataKey,
  id: string,
  archived: boolean,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<ArchiveResult> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return "signed_out";
  const organizationId = session.activeOrganizationId;
  if (!organizationId) return "forbidden";

  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    organizationId,
    path: `/v1${MASTER_DATA[kind].path}/${id}`,
    method: "PATCH",
    json: { archived },
    schema: recordSchema,
    fetchFn,
  });
  if (result.ok) return "done";
  if (result.status === 401) return "signed_out";
  if (result.status === 403) return "forbidden";
  if (result.status === 404) return "not_found";
  if (result.code === "name_taken") return "name_taken";
  deps.log(`Archiving a ${kind} record failed with HTTP ${result.status} (${result.code})`);
  return "unavailable";
}
