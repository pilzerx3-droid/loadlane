"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { localTimeToIso, parseUsd } from "@loadlane/shared";
import { apiRequest, organizationDetailSchema } from "../lib/api-client";
import { cookieNames } from "../lib/cookies";
import { getAuthDeps } from "../lib/deps";
import { awardBid, cancelTender, createTender, enterBid, type SpotResult } from "../lib/spot";
import { loadSession } from "../lib/auth-routes";

// Server actions for spot freight. The API checks permission, status and deadline again.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateTenderState {
  /** One link per invited carrier, shown once. Never put in a URL of this site. */
  links?: {
    carrierId: string;
    carrierName: string;
    url: string;
    mail?: "sent" | "failed" | "skipped";
  }[];
  mailRequested?: boolean;
  tenderId?: string;
  message?: string;
}

const CREATE_MESSAGES = {
  mail_unconfigured:
    "E-mail is not set up on this server yet, so nothing was created. Untick the e-mail option to create the offer and copy the links yourself.",
  invalid: "Check the deadline (in the future) and choose at least one carrier.",
  not_offerable: "Only a transport that is created or planned can be offered to carriers.",
  already_open: "This transport already has an open offer.",
  forbidden: "You do not have permission to create spot freight offers.",
  not_found: "This transport no longer exists.",
  not_open: "This offer is no longer open.",
  bid_not_live: "That bid is not valid any more.",
  unavailable: "Loadlane could not save this right now. Please try again in a moment.",
} as const;

async function currentSession() {
  const deps = getAuthDeps();
  const sessionId = (await cookies()).get(cookieNames(deps.config.secureCookies).session)?.value;
  return { deps, sessionId };
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function createTenderAction(
  _previous: CreateTenderState | undefined,
  formData: FormData,
): Promise<CreateTenderState> {
  void _previous; // the shape useActionState requires
  const transportId = text(formData, "transportId");
  if (!UUID_PATTERN.test(transportId)) redirect("/transports");
  const { deps, sessionId } = await currentSession();

  // The deadline is typed in the organization's time zone.
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session?.activeOrganizationId) redirect("/");
  const organization = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    organizationId: session.activeOrganizationId,
    path: "/v1/organization",
    schema: organizationDetailSchema,
  });
  const timeZone = organization.ok ? organization.data.timezone : "UTC";
  const responseDeadline = localTimeToIso(text(formData, "responseDeadline"), timeZone);
  const carrierIds = formData.getAll("carrierId").filter((v): v is string => typeof v === "string");
  const carrierNames: Record<string, string> = {};
  for (const entry of formData.getAll("carrierName")) {
    if (typeof entry !== "string") continue;
    const [id, ...rest] = entry.split("|");
    if (id) carrierNames[id] = rest.join("|");
  }
  const sendEmail = formData.get("sendEmail") === "on";
  const targetText = text(formData, "targetPrice");
  const target = targetText === "" ? null : (parseUsd(targetText) ?? undefined);
  if (!responseDeadline || target === undefined || carrierIds.length === 0) {
    return { message: CREATE_MESSAGES.invalid };
  }
  const result = await createTender(
    sessionId,
    {
      transportId,
      responseDeadline,
      targetPriceCents: target,
      notes: text(formData, "notes"),
      carrierIds,
      carrierNames,
      sendEmail,
    },
    deps,
  );
  if (result.status === "signed_out") redirect("/");
  if (result.status === "created") {
    return { links: result.links, tenderId: result.id, mailRequested: sendEmail };
  }
  return { message: CREATE_MESSAGES[result.status] };
}

function finish(result: SpotResult, id: string): never {
  if (result.status === "signed_out") redirect("/");
  redirect(result.status === "done" ? `/spot/${id}` : `/spot/${id}?problem=${result.status}`);
}

export async function awardBidAction(tenderId: string, formData: FormData): Promise<void> {
  const bidId = text(formData, "bidId");
  if (!UUID_PATTERN.test(tenderId) || !UUID_PATTERN.test(bidId)) redirect("/spot");
  const { deps, sessionId } = await currentSession();
  finish(await awardBid(sessionId, tenderId, bidId, text(formData, "note"), deps), tenderId);
}

export async function cancelTenderAction(tenderId: string): Promise<void> {
  if (!UUID_PATTERN.test(tenderId)) redirect("/spot");
  const { deps, sessionId } = await currentSession();
  finish(await cancelTender(sessionId, tenderId, deps), tenderId);
}

export async function enterBidAction(tenderId: string, formData: FormData): Promise<void> {
  const carrierId = text(formData, "carrierId");
  if (!UUID_PATTERN.test(tenderId) || !UUID_PATTERN.test(carrierId)) redirect("/spot");
  const price = parseUsd(text(formData, "price"));
  if (price === undefined || price < 1) redirect(`/spot/${tenderId}?problem=invalid`);
  const { deps, sessionId } = await currentSession();
  finish(
    await enterBid(sessionId, tenderId, carrierId, price, text(formData, "note"), deps),
    tenderId,
  );
}
