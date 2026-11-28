"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieNames } from "../lib/cookies";
import { getAuthDeps } from "../lib/deps";
import {
  geocodeLocation,
  parseCoordinate,
  setLocationCoordinates,
  type LocationGeoResult,
} from "../lib/location-geo";

// Server actions for the coordinates of a location. The API checks permission and ranges again.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function currentSession() {
  const deps = getAuthDeps();
  const sessionId = (await cookies()).get(cookieNames(deps.config.secureCookies).session)?.value;
  return { deps, sessionId };
}

function finish(result: LocationGeoResult, id: string): never {
  if (result.status === "signed_out") redirect("/");
  redirect(`/locations/${id}?geo=${result.status}`);
}

export async function geocodeLocationAction(id: string): Promise<void> {
  if (!UUID_PATTERN.test(id)) redirect("/locations");
  const { deps, sessionId } = await currentSession();
  finish(await geocodeLocation(sessionId, id, deps), id);
}

export async function setCoordinatesAction(id: string, formData: FormData): Promise<void> {
  if (!UUID_PATTERN.test(id)) redirect("/locations");
  const field = (name: string): string => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const latitude = parseCoordinate(field("latitude"), 90);
  const longitude = parseCoordinate(field("longitude"), 180);
  if (latitude === undefined || longitude === undefined) redirect(`/locations/${id}?geo=invalid`);
  const { deps, sessionId } = await currentSession();
  finish(await setLocationCoordinates(sessionId, id, latitude, longitude, deps), id);
}
