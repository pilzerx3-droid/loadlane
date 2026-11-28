"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buildCalculation, parseCalcPayload, type CalcFormErrors } from "../lib/calculation-form";
import { duplicateCalculation, saveCalculation } from "../lib/calculations";
import { cookieNames } from "../lib/cookies";
import { getAuthDeps } from "../lib/deps";

// Server action of the calculator form. The values are checked again here and by the API.

export interface CalcFormState {
  payload: string;
  errors: CalcFormErrors;
  message?: string;
}

const MESSAGES = {
  invalid: "The API did not accept these values. Check the fields and try again.",
  forbidden: "You do not have permission to save calculations.",
  unavailable: "Loadlane could not save this right now. Please try again in a moment.",
} as const;

export async function saveCalculationAction(
  _previous: CalcFormState | undefined,
  formData: FormData,
): Promise<CalcFormState> {
  void _previous; // the shape useActionState requires
  const raw = formData.get("payload");
  const payload = typeof raw === "string" ? raw : "";
  const built = buildCalculation(parseCalcPayload(payload));
  if (!built.ok) return { payload, errors: built.errors };

  const deps = getAuthDeps();
  const sessionId = (await cookies()).get(cookieNames(deps.config.secureCookies).session)?.value;
  const result = await saveCalculation(sessionId, built.input, deps);
  if (result.status === "saved") redirect(`/calculations/${result.id}`);
  if (result.status === "signed_out") redirect("/");
  return { payload, errors: {}, message: MESSAGES[result.status] };
}

/** Copies a calculation and opens the copy. A problem returns to the original with `?problem=`. */
export async function duplicateCalculationAction(id: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    redirect("/calculations");
  const deps = getAuthDeps();
  const sessionId = (await cookies()).get(cookieNames(deps.config.secureCookies).session)?.value;
  const result = await duplicateCalculation(sessionId, id, deps);
  if (result.status === "signed_out") redirect("/");
  redirect(
    result.status === "done"
      ? `/calculations/${result.id}`
      : `/calculations/${id}?problem=${result.status}`,
  );
}
