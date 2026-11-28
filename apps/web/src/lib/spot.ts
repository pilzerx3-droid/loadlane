import { z } from "zod";
import { apiRequest } from "./api-client";
import { loadSession, type AuthDeps } from "./auth-routes";

const carrierRef = z.object({ id: z.string(), name: z.string() });

export const tenderSummarySchema = z.object({
  id: z.string(),
  status: z.enum(["open", "awarded", "cancelled", "closed"]),
  transport: z.object({ id: z.string(), reference: z.string(), status: z.string() }),
  origin: z.string(),
  destination: z.string(),
  responseDeadline: z.string(),
  deadlinePassed: z.boolean(),
  invited: z.number(),
  liveBids: z.number(),
  lowestLiveBidCents: z.number().nullable(),
  createdAt: z.string(),
});

export const tenderListSchema = z.object({
  items: z.array(tenderSummarySchema),
  page: z.object({ total: z.number().int() }),
});

export const tenderDetailSchema = tenderSummarySchema.extend({
  targetPriceCents: z.number().nullable(),
  notes: z.string().nullable(),
  awardedAt: z.string().nullable(),
  awardedBy: z.object({ id: z.string(), displayName: z.string() }).nullable(),
  stops: z.array(
    z.object({
      sequence: z.number(),
      type: z.enum(["pickup", "delivery"]),
      placeName: z.string(),
      city: z.string(),
      state: z.string(),
      windowStart: z.string(),
      windowEnd: z.string(),
      timezone: z.string(),
    }),
  ),
  invitations: z.array(
    z.object({
      id: z.string(),
      carrier: carrierRef,
      state: z.enum(["active", "expired", "revoked"]),
      expiresAt: z.string(),
    }),
  ),
  bids: z.array(
    z.object({
      id: z.string(),
      carrier: carrierRef,
      priceCents: z.number(),
      note: z.string().nullable(),
      status: z.enum(["submitted", "superseded", "withdrawn", "rejected", "awarded"]),
      source: z.enum(["carrier_link", "staff"]),
      createdAt: z.string(),
    }),
  ),
});

export const createdTenderSchema = tenderDetailSchema.extend({
  links: z.array(z.object({ carrierId: z.string(), token: z.string() })),
});

export type TenderSummary = z.infer<typeof tenderSummarySchema>;
export type TenderDetail = z.infer<typeof tenderDetailSchema>;

export type SpotResult =
  | { status: "done"; id: string }
  | {
      status:
        | "invalid"
        | "not_offerable"
        | "already_open"
        | "not_open"
        | "bid_not_live"
        | "forbidden"
        | "not_found"
        | "signed_out"
        | "unavailable";
    };

export type CreateTenderResult =
  | {
      status: "created";
      id: string;
      links: { carrierId: string; carrierName: string; url: string }[];
    }
  | Exclude<SpotResult, { status: "done" }>;

export function spotUrl(appOrigin: string, token: string): string {
  return `${appOrigin}/s/${encodeURIComponent(token)}`;
}

function mapFailure(
  result: { status: number; code: string; errors: { path: string; code: string }[] },
  deps: AuthDeps,
): Exclude<SpotResult, { status: "done" }> {
  if (result.status === 401) return { status: "signed_out" };
  if (result.status === 403) return { status: "forbidden" };
  if (result.status === 404) return { status: "not_found" };
  if (result.status === 409) {
    if (result.code === "transport_not_offerable") return { status: "not_offerable" };
    if (result.code === "tender_already_open") return { status: "already_open" };
    if (result.code === "tender_not_open") return { status: "not_open" };
    if (result.code === "bid_not_live") return { status: "bid_not_live" };
    return { status: "invalid" };
  }
  if (result.status === 400) return { status: "invalid" };
  deps.log(`A spot freight call failed with HTTP ${result.status} (${result.code})`);
  return { status: "unavailable" };
}

async function sessionOf(sessionId: string | undefined, deps: AuthDeps) {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return "signed_out" as const;
  if (!session.activeOrganizationId) return "forbidden" as const;
  return { token: session.accessToken, organizationId: session.activeOrganizationId };
}

export interface NewTender {
  transportId: string;
  responseDeadline: string;
  targetPriceCents: number | null;
  notes: string;
  carrierIds: string[];
  carrierNames: Record<string, string>;
}

export async function createTender(
  sessionId: string | undefined,
  tender: NewTender,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<CreateTenderResult> {
  const session = await sessionOf(sessionId, deps);
  if (session === "signed_out" || session === "forbidden") return { status: session };
  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.token,
    organizationId: session.organizationId,
    path: "/v1/spot-tenders",
    json: {
      transportId: tender.transportId,
      responseDeadline: tender.responseDeadline,
      targetPriceCents: tender.targetPriceCents,
      notes: tender.notes,
      carrierIds: tender.carrierIds,
    },
    schema: createdTenderSchema,
    fetchFn,
  });
  if (!result.ok) return mapFailure(result, deps);
  return {
    status: "created",
    id: result.data.id,
    links: result.data.links.map((link) => ({
      carrierId: link.carrierId,
      carrierName: tender.carrierNames[link.carrierId] ?? "Carrier",
      url: spotUrl(deps.config.appUrl.origin, link.token),
    })),
  };
}

async function post(
  sessionId: string | undefined,
  deps: AuthDeps,
  path: string,
  json: unknown,
  fetchFn: typeof fetch,
): Promise<SpotResult> {
  const session = await sessionOf(sessionId, deps);
  if (session === "signed_out" || session === "forbidden") return { status: session };
  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.token,
    organizationId: session.organizationId,
    path,
    json,
    schema: z.looseObject({ id: z.string().optional() }),
    fetchFn,
  });
  if (!result.ok) return mapFailure(result, deps);
  return { status: "done", id: result.data.id ?? "" };
}

export const awardBid = (
  sessionId: string | undefined,
  tenderId: string,
  bidId: string,
  note: string,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
) => post(sessionId, deps, `/v1/spot-tenders/${tenderId}/award`, { bidId, note }, fetchFn);

export const cancelTender = (
  sessionId: string | undefined,
  tenderId: string,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
) => post(sessionId, deps, `/v1/spot-tenders/${tenderId}/cancel`, {}, fetchFn);

export const enterBid = (
  sessionId: string | undefined,
  tenderId: string,
  carrierId: string,
  priceCents: number,
  note: string,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
) =>
  post(
    sessionId,
    deps,
    `/v1/spot-tenders/${tenderId}/bids`,
    { carrierId, priceCents, note },
    fetchFn,
  );

// ---- The carrier's page (no sign-in; the link token is the credential) ----

export const carrierOfferSchema = z.object({
  state: z.enum(["open", "deadline_passed", "awarded_to_you", "closed"]),
  transportReference: z.string(),
  responseDeadline: z.string(),
  weightLb: z.number().nullable(),
  pieces: z.number().nullable(),
  stops: z.array(
    z.object({
      sequence: z.number(),
      type: z.enum(["pickup", "delivery"]),
      city: z.string(),
      state: z.string(),
      windowStart: z.string(),
      windowEnd: z.string(),
      timezone: z.string(),
    }),
  ),
  yourBid: z
    .object({
      priceCents: z.number(),
      note: z.string().nullable(),
      status: z.enum(["submitted", "superseded", "withdrawn", "rejected", "awarded"]),
      createdAt: z.string(),
    })
    .nullable(),
});

export type CarrierOffer = z.infer<typeof carrierOfferSchema>;

export type CarrierFailure =
  "invalid" | "gone" | "closed" | "deadline_passed" | "rejected" | "unavailable";

export type CarrierResult =
  { ok: true; data: CarrierOffer } | { ok: false; reason: CarrierFailure };

export const CARRIER_FAILURE_MESSAGES: Record<CarrierFailure, string> = {
  invalid: "This link is not valid.",
  gone: "This link is no longer active. Ask the shipper for a new one.",
  closed: "This offer is closed.",
  deadline_passed: "The response deadline has passed.",
  rejected: "That price was not accepted. Enter a price in dollars, for example 850 or 1,250.50.",
  unavailable: "Loadlane could not be reached. Please try again in a moment.",
};

/** Calls the carrier endpoints. The token goes in a header, never in the API address. */
export async function carrierRequest(options: {
  apiUrl: string;
  token: string;
  path: "offer" | "bid" | "bid/withdraw";
  json?: unknown;
  fetchFn?: typeof fetch;
}): Promise<CarrierResult> {
  const { apiUrl, token, path, json, fetchFn = fetch } = options;
  let response: Response;
  try {
    response = await fetchFn(`${apiUrl}/v1/spot/${path}`, {
      method: json === undefined ? "GET" : "POST",
      headers: {
        "x-spot-token": token,
        accept: "application/json",
        ...(json === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (response.ok) {
    const parsed = carrierOfferSchema.safeParse(await response.json().catch(() => undefined));
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, reason: "unavailable" };
  }
  const problem = (await response.json().catch(() => ({}))) as { code?: unknown };
  if (response.status === 404) return { ok: false, reason: "invalid" };
  if (response.status === 410) return { ok: false, reason: "gone" };
  if (response.status === 409) {
    return { ok: false, reason: problem.code === "deadline_passed" ? "deadline_passed" : "closed" };
  }
  if (response.status === 400) return { ok: false, reason: "rejected" };
  return { ok: false, reason: "unavailable" };
}
