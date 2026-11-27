import { z } from "zod";
import { apiRequest } from "./api-client";
import { loadSession, type AuthDeps } from "./auth-routes";
import {
  buildTransportInput,
  formFieldFor,
  type FormErrors,
  type TransportFormValues,
} from "./transport-form";

const idSchema = z.looseObject({ id: z.string() });
const locationSchema = z.looseObject({ timezone: z.string() });

export type SaveTransportResult =
  | { status: "saved"; id: string }
  | { status: "invalid"; errors: FormErrors }
  | {
      status:
        | "transport_not_editable"
        | "carrier_required"
        | "forbidden"
        | "not_found"
        | "signed_out"
        | "unavailable";
    };

/**
 * Creates (`id` undefined) or changes a transport. The time zone of every stop's location is looked
 * up first, because the times in the form are read in those zones.
 */
export async function saveTransport(
  sessionId: string | undefined,
  id: string | undefined,
  values: TransportFormValues,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<SaveTransportResult> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return { status: "signed_out" };
  const organizationId = session.activeOrganizationId;
  if (!organizationId) return { status: "forbidden" };
  const base = {
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    organizationId,
    fetchFn,
  };

  const timezones: Record<string, string> = {};
  for (const locationId of new Set(values.stops.map((stop) => stop.locationId).filter(Boolean))) {
    const location = await apiRequest({
      ...base,
      path: `/v1/locations/${locationId}`,
      schema: locationSchema,
    });
    if (location.ok) timezones[locationId] = location.data.timezone;
    else if (location.status === 401) return { status: "signed_out" };
    else if (location.status === 403) return { status: "forbidden" };
    else if (location.status !== 404 && location.status !== 400) return { status: "unavailable" };
  }

  const { input, errors } = buildTransportInput(values, timezones);
  if (Object.keys(errors).length > 0) return { status: "invalid", errors };

  const result = await apiRequest({
    ...base,
    path: id === undefined ? "/v1/transports" : `/v1/transports/${id}`,
    method: id === undefined ? "POST" : "PATCH",
    json: input,
    schema: idSchema,
  });
  if (result.ok) return { status: "saved", id: result.data.id };
  if (result.status === 401) return { status: "signed_out" };
  if (result.status === 403) return { status: "forbidden" };
  if (result.status === 404) return { status: "not_found" };
  if (result.code === "validation_failed") {
    const fieldErrors: FormErrors = {};
    for (const error of result.errors) fieldErrors[formFieldFor(error.path)] ??= error.message;
    return { status: "invalid", errors: fieldErrors };
  }
  if (result.code === "transport_not_editable" || result.code === "carrier_required") {
    return { status: result.code };
  }
  deps.log(`Saving a transport failed with HTTP ${result.status} (${result.code})`);
  return { status: "unavailable" };
}

export type StatusChangeResult =
  | "done"
  | "invalid_transition"
  | "carrier_required"
  | "forbidden"
  | "not_found"
  | "signed_out"
  | "unavailable";

/** Moves a transport to another status. The API checks the status model; the web app only reports the outcome. */
export async function changeTransportStatus(
  sessionId: string | undefined,
  id: string,
  status: string,
  note: string,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<StatusChangeResult> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return "signed_out";
  const organizationId = session.activeOrganizationId;
  if (!organizationId) return "forbidden";

  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    organizationId,
    path: `/v1/transports/${id}/status`,
    json: note === "" ? { status } : { status, note },
    schema: idSchema,
    fetchFn,
  });
  if (result.ok) return "done";
  if (result.status === 401) return "signed_out";
  if (result.status === 403) return "forbidden";
  if (result.status === 404) return "not_found";
  if (result.code === "invalid_transition" || result.code === "carrier_required")
    return result.code;
  deps.log(`Changing a transport status failed with HTTP ${result.status} (${result.code})`);
  return "unavailable";
}
