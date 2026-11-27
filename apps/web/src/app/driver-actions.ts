"use server";

import { CONSENT_TEXT_VERSION } from "@loadlane/shared";
import { z } from "zod";
import { getAuthDeps } from "../lib/deps";
import {
  driverJobSchema,
  driverRequest,
  type DriverFailure,
  type DriverJobView,
} from "../lib/driver-api";

// Server actions of the driver page. No sign-in exists here: the link token is the credential and
// the API checks it on every call. The token is not logged.

export type DriverActionResult =
  { ok: true; job: DriverJobView } | { ok: false; reason: DriverFailure };

const acceptedSchema = z.object({ accepted: z.literal(true) });

async function job(token: string, path: string, json?: unknown): Promise<DriverActionResult> {
  const result = await driverRequest({
    apiUrl: getAuthDeps().config.apiUrl,
    token,
    path,
    schema: driverJobSchema,
    ...(json === undefined ? {} : { json }),
  });
  return result.ok ? { ok: true, job: result.data } : result;
}

export async function driverConsentAction(token: string): Promise<DriverActionResult> {
  return job(token, "consent", { textVersion: CONSENT_TEXT_VERSION });
}

export async function driverWithdrawAction(token: string): Promise<DriverActionResult> {
  return job(token, "consent/withdraw", {});
}

export async function driverStatusAction(
  token: string,
  status: string,
): Promise<DriverActionResult> {
  return job(token, "status", { status });
}

export async function driverRefreshAction(token: string): Promise<DriverActionResult> {
  return job(token, "job");
}

export async function driverPositionAction(
  token: string,
  report: { latitude: number; longitude: number; accuracyM: number | null; recordedAt: string },
): Promise<{ ok: true } | { ok: false; reason: DriverFailure }> {
  const result = await driverRequest({
    apiUrl: getAuthDeps().config.apiUrl,
    token,
    path: "position",
    schema: acceptedSchema,
    json: report,
  });
  return result.ok ? { ok: true } : result;
}
