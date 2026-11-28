import { z } from "zod";
import { apiRequest } from "./api-client";
import { loadSession, type AuthDeps } from "./auth-routes";

export type LocationGeoResult =
  | { status: "done" }
  | {
      status:
        | "address_not_found"
        | "invalid"
        | "lookup_failed"
        | "not_configured"
        | "forbidden"
        | "not_found"
        | "signed_out"
        | "unavailable";
    };

const coordinatesSchema = z.object({ latitude: z.number(), longitude: z.number() });

async function call(
  sessionId: string | undefined,
  deps: AuthDeps,
  path: string,
  method: "POST" | "PUT",
  json: unknown,
  fetchFn: typeof fetch,
): Promise<LocationGeoResult> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return { status: "signed_out" };
  const organizationId = session.activeOrganizationId;
  if (!organizationId) return { status: "forbidden" };
  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    organizationId,
    path,
    method,
    json,
    schema: coordinatesSchema,
    fetchFn,
  });
  if (result.ok) return { status: "done" };
  if (result.status === 401) return { status: "signed_out" };
  if (result.status === 403) return { status: "forbidden" };
  if (result.status === 404) return { status: "not_found" };
  if (result.status === 422 && result.code === "address_not_found") {
    return { status: "address_not_found" };
  }
  if (result.status === 400) return { status: "invalid" };
  if (result.status === 502) return { status: "lookup_failed" };
  if (result.status === 503 && result.code === "geocoding_not_configured") {
    return { status: "not_configured" };
  }
  deps.log(`A location coordinates call failed with HTTP ${result.status} (${result.code})`);
  return { status: "unavailable" };
}

/** Looks the address up with the server's geocoding provider and stores the match. */
export function geocodeLocation(
  sessionId: string | undefined,
  id: string,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<LocationGeoResult> {
  return call(sessionId, deps, `/v1/locations/${id}/geocode`, "POST", {}, fetchFn);
}

/** Stores coordinates a person entered. */
export function setLocationCoordinates(
  sessionId: string | undefined,
  id: string,
  latitude: number,
  longitude: number,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<LocationGeoResult> {
  return call(
    sessionId,
    deps,
    `/v1/locations/${id}/coordinates`,
    "PUT",
    { latitude, longitude },
    fetchFn,
  );
}

/** Reads text like "32.7767" or "-96.797". Rejects empty text, other characters and out-of-range values. */
export function parseCoordinate(text: string, limit: number): number | undefined {
  const trimmed = text.trim();
  if (!/^-?\d{1,3}(\.\d{1,8})?$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Math.abs(value) <= limit ? value : undefined;
}

export const LOCATION_GEO_MESSAGES: Record<string, string> = {
  done: "Coordinates saved.",
  address_not_found:
    "The lookup service has no confident match for this address. Check the address or enter the coordinates yourself.",
  invalid: "Enter a latitude between -90 and 90 and a longitude between -180 and 180.",
  lookup_failed:
    "The address lookup service did not answer. Try again later or enter the coordinates yourself.",
  not_configured:
    "Address lookup is not set up on this server (no ORS_API_KEY). Enter the coordinates yourself.",
  forbidden: "You do not have permission to change locations.",
  not_found: "This location no longer exists.",
  unavailable: "Loadlane could not save this right now. Please try again in a moment.",
};
