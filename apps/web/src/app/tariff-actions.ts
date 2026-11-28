"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buildTariff, parseTariffPayload } from "../lib/tariff-form";
import {
  addTariffVersion,
  applyTariffToShipment,
  createTariff,
  setTariffArchived,
  type ApplyResult,
  type TariffResult,
} from "../lib/tariffs";
import { cookieNames } from "../lib/cookies";
import { getAuthDeps } from "../lib/deps";

// Server actions for tariffs. The API checks permission, dates and the lines again.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TariffFormState {
  payload: string;
  errors: Record<string, string>;
  message?: string;
}

const MESSAGES = {
  invalid: "The API did not accept these values. Check the fields and try again.",
  date_taken: "Another version already starts on that date. Choose a different start date.",
  archived: "This price list is archived. Restore it before adding a version.",
  forbidden: "You do not have permission to change price lists.",
  not_found: "This price list no longer exists.",
  unavailable: "Loadlane could not save this right now. Please try again in a moment.",
} as const;

async function currentSession() {
  const deps = getAuthDeps();
  const sessionId = (await cookies()).get(cookieNames(deps.config.secureCookies).session)?.value;
  return { deps, sessionId };
}

const today = () => new Date().toISOString().slice(0, 10);

function outcome(result: TariffResult, payload: string, okPath: string): TariffFormState {
  if (result.status === "signed_out") redirect("/");
  if (result.status === "done") redirect(okPath);
  return { payload, errors: {}, message: MESSAGES[result.status] };
}

/** `id` is empty for a new price list; otherwise a new version is added to that list. */
export async function saveTariffAction(
  id: string,
  _previous: TariffFormState | undefined,
  formData: FormData,
): Promise<TariffFormState> {
  void _previous; // the shape useActionState requires
  if (id !== "" && !UUID_PATTERN.test(id)) redirect("/tariffs");
  const raw = formData.get("payload");
  const payload = typeof raw === "string" ? raw : "";
  const built = buildTariff(parseTariffPayload(payload, today()), id === "");
  if (!built.ok) return { payload, errors: built.errors };
  const { deps, sessionId } = await currentSession();
  if (id === "") {
    const result = await createTariff(sessionId, built.input, deps);
    return outcome(
      result,
      payload,
      result.status === "done" ? `/tariffs/${result.id}` : "/tariffs",
    );
  }
  const { validFrom, note, lines } = built.input;
  const result = await addTariffVersion(sessionId, id, { validFrom, note, lines }, deps);
  return outcome(result, payload, `/tariffs/${id}`);
}

export async function archiveTariffAction(id: string, archived: boolean): Promise<void> {
  if (!UUID_PATTERN.test(id)) redirect("/tariffs");
  const { deps, sessionId } = await currentSession();
  const result = await setTariffArchived(sessionId, id, archived, deps);
  if (result.status === "signed_out") redirect("/");
  redirect(`/tariffs/${id}`);
}

export type ApplyActionResult = { ok: true; result: ApplyResult } | { ok: false; message: string };

const APPLY_MESSAGES = {
  missing_quantity:
    "This price list needs a quantity for every unit it uses (miles, pallets, ...).",
  no_version: "No version of this price list is in force on that date.",
  forbidden: "You do not have permission to use price lists.",
  not_found: "This price list no longer exists.",
  unavailable: "Loadlane could not price this right now. Please try again in a moment.",
} as const;

/** Prices a shipment with a tariff for the calculator. Nothing is saved. */
export async function applyTariffAction(
  tariffId: string,
  date: string,
  quantities: Record<string, number>,
): Promise<ApplyActionResult> {
  if (!UUID_PATTERN.test(tariffId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: APPLY_MESSAGES.not_found };
  }
  const clean: Record<string, number> = {};
  for (const unit of ["mile", "pallet", "lb", "hour"]) {
    const value = quantities[unit];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) clean[unit] = value;
  }
  const { deps, sessionId } = await currentSession();
  const result = await applyTariffToShipment(sessionId, tariffId, date, clean, deps);
  if (result.status === "signed_out") redirect("/");
  if (result.status === "ok") return { ok: true, result: result.result };
  return { ok: false, message: APPLY_MESSAGES[result.status] };
}
