"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieNames } from "../lib/cookies";
import { getAuthDeps } from "../lib/deps";
import {
  parseTransportForm,
  type FormErrors,
  type TransportFormValues,
} from "../lib/transport-form";
import { changeTransportStatus, saveTransport } from "../lib/transport-actions";
import { importTransports, type ImportReport } from "../lib/transport-import";

// Server actions for transports. Next.js checks that the request comes from this site; the API
// checks the permission and the status model again for every call.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TransportFormState {
  values: TransportFormValues;
  errors: FormErrors;
  message?: string;
}

const MESSAGES = {
  transport_not_editable: "This transport is already on the road and can no longer be edited.",
  carrier_required: "Choose a carrier first: an assigned transport needs one.",
  forbidden: "You do not have permission to change transports.",
  not_found: "This transport no longer exists.",
  unavailable: "Loadlane could not save this right now. Please try again in a moment.",
} as const;

async function currentSession() {
  const deps = getAuthDeps();
  const sessionId = (await cookies()).get(cookieNames(deps.config.secureCookies).session)?.value;
  return { deps, sessionId };
}

/** Saves the transport form. `id` is empty for a new transport. On success the person sees the transport. */
export async function saveTransportAction(
  id: string,
  _previous: TransportFormState | undefined,
  formData: FormData,
): Promise<TransportFormState> {
  if (id !== "" && !UUID_PATTERN.test(id)) redirect("/transports");
  const values = parseTransportForm(formData);
  const { deps, sessionId } = await currentSession();
  const result = await saveTransport(sessionId, id === "" ? undefined : id, values, deps);

  if (result.status === "saved") redirect(`/transports/${result.id}`);
  if (result.status === "signed_out") redirect("/");
  if (result.status === "invalid") return { values, errors: result.errors };
  return { values, errors: {}, message: MESSAGES[result.status] };
}

/** Moves a transport to the status chosen on its page. Problems come back as `?problem=` on the page. */
export async function changeStatusAction(id: string, formData: FormData): Promise<void> {
  if (!UUID_PATTERN.test(id)) redirect("/transports");
  const status = formData.get("status");
  const note = formData.get("note");
  const { deps, sessionId } = await currentSession();
  const result = await changeTransportStatus(
    sessionId,
    id,
    typeof status === "string" ? status : "",
    typeof note === "string" ? note.trim() : "",
    deps,
  );
  if (result === "signed_out") redirect("/");
  redirect(result === "done" ? `/transports/${id}` : `/transports/${id}?problem=${result}`);
}

export interface ImportState {
  csv: string;
  report?: ImportReport;
  message?: string;
}

const IMPORT_MESSAGES = {
  too_large:
    "The file is empty or too large. Import at most 200 rows (about 90,000 characters) at a time.",
  forbidden: "You do not have permission to import transports.",
  unavailable: "Loadlane could not check the file right now. Please try again in a moment.",
} as const;

/** Checks the pasted or uploaded CSV, or imports it when the person pressed "Import". */
export async function importTransportsAction(
  _previous: ImportState | undefined,
  formData: FormData,
): Promise<ImportState> {
  const text = formData.get("csv");
  const csv = typeof text === "string" ? text : "";
  const dryRun = formData.get("intent") !== "import";
  const { deps, sessionId } = await currentSession();
  const result = await importTransports(sessionId, csv, dryRun, deps);
  if (result.status === "signed_out") redirect("/");
  if (result.status === "ok") return { csv, report: result.report };
  return { csv, message: IMPORT_MESSAGES[result.status] };
}
