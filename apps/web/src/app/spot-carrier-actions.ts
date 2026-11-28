"use server";

import { parseUsd } from "@loadlane/shared";
import { getAuthDeps } from "../lib/deps";
import { carrierRequest, type CarrierResult } from "../lib/spot";

// Server actions of the carrier page. No sign-in: the link token is the credential and the API
// checks it on every call. The token is not logged.

export async function submitCarrierBidAction(
  token: string,
  priceText: string,
  note: string,
): Promise<CarrierResult> {
  const priceCents = parseUsd(priceText);
  if (priceCents === undefined || priceCents < 1) return { ok: false, reason: "rejected" };
  return carrierRequest({
    apiUrl: getAuthDeps().config.apiUrl,
    token,
    path: "bid",
    json: { priceCents, note: note.trim().slice(0, 500) },
  });
}

export async function withdrawCarrierBidAction(token: string): Promise<CarrierResult> {
  return carrierRequest({
    apiUrl: getAuthDeps().config.apiUrl,
    token,
    path: "bid/withdraw",
    json: {},
  });
}
