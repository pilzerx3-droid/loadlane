import { z } from "zod";
import { apiRequest } from "./api-client";
import { loadSession, type AuthDeps } from "./auth-routes";
import type { TariffInput, VersionInput } from "./tariff-form";

const lineSchema = z.object({
  kind: z.string(),
  label: z.string(),
  unit: z.string(),
  rateCents: z.number(),
  minimumCents: z.number().nullable(),
});

const versionSchema = z.object({
  id: z.string(),
  version: z.number(),
  validFrom: z.string(),
  note: z.string().nullable(),
  lines: z.array(lineSchema),
  createdAt: z.string(),
  createdBy: z.object({ id: z.string(), displayName: z.string() }),
});

export const tariffSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["sell", "buy"]),
  party: z.object({ id: z.string(), name: z.string() }).nullable(),
  archived: z.boolean(),
  versions: z.number(),
  latestValidFrom: z.string().nullable(),
  createdAt: z.string(),
});

export const tariffListSchema = z.object({
  items: z.array(tariffSummarySchema),
  page: z.object({ total: z.number().int() }),
});

export const tariffDetailSchema = tariffSummarySchema.extend({
  currentVersion: versionSchema.nullable(),
  allVersions: z.array(versionSchema),
});

export const applyResultSchema = z.object({
  tariffId: z.string(),
  tariffName: z.string(),
  versionId: z.string(),
  version: z.number(),
  validFrom: z.string(),
  lines: z.array(
    z.object({
      kind: z.string(),
      label: z.string(),
      amountCents: z.number(),
      minimumApplied: z.boolean(),
      basis: z
        .object({ rateCents: z.number(), quantityThousandths: z.number(), unit: z.string() })
        .nullable(),
    }),
  ),
  totalCents: z.number(),
});

export type TariffSummary = z.infer<typeof tariffSummarySchema>;
export type TariffDetail = z.infer<typeof tariffDetailSchema>;
export type TariffVersion = z.infer<typeof versionSchema>;
export type ApplyResult = z.infer<typeof applyResultSchema>;

export type TariffResult =
  | { status: "done"; id: string }
  | {
      status:
        | "invalid"
        | "date_taken"
        | "archived"
        | "forbidden"
        | "not_found"
        | "signed_out"
        | "unavailable";
    };

async function sessionOf(sessionId: string | undefined, deps: AuthDeps) {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return "signed_out" as const;
  if (!session.activeOrganizationId) return "forbidden" as const;
  return { token: session.accessToken, organizationId: session.activeOrganizationId };
}

function mapFailure(
  result: { status: number; code: string },
  deps: AuthDeps,
): Exclude<TariffResult, { status: "done" }> {
  if (result.status === 401) return { status: "signed_out" };
  if (result.status === 403) return { status: "forbidden" };
  if (result.status === 404) return { status: "not_found" };
  if (result.status === 409) {
    return { status: result.code === "tariff_archived" ? "archived" : "date_taken" };
  }
  if (result.status === 400) return { status: "invalid" };
  deps.log(`A tariff call failed with HTTP ${result.status} (${result.code})`);
  return { status: "unavailable" };
}

async function post(
  sessionId: string | undefined,
  deps: AuthDeps,
  path: string,
  json: unknown,
  fetchFn: typeof fetch,
): Promise<TariffResult> {
  const session = await sessionOf(sessionId, deps);
  if (session === "signed_out" || session === "forbidden") return { status: session };
  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.token,
    organizationId: session.organizationId,
    path,
    json,
    schema: z.looseObject({ id: z.string() }),
    fetchFn,
  });
  return result.ok ? { status: "done", id: result.data.id } : mapFailure(result, deps);
}

export const createTariff = (
  sessionId: string | undefined,
  input: TariffInput,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
) => post(sessionId, deps, "/v1/tariffs", input, fetchFn);

export const addTariffVersion = (
  sessionId: string | undefined,
  tariffId: string,
  input: VersionInput,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
) => post(sessionId, deps, `/v1/tariffs/${tariffId}/versions`, input, fetchFn);

export const setTariffArchived = (
  sessionId: string | undefined,
  tariffId: string,
  archived: boolean,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
) =>
  post(sessionId, deps, `/v1/tariffs/${tariffId}/${archived ? "archive" : "restore"}`, {}, fetchFn);

export type ApplyOutcome =
  | { status: "ok"; result: ApplyResult }
  | {
      status:
        | "missing_quantity"
        | "no_version"
        | "forbidden"
        | "not_found"
        | "signed_out"
        | "unavailable";
    };

/** Prices a shipment with a tariff. Nothing is saved; the lines fill the calculator. */
export async function applyTariffToShipment(
  sessionId: string | undefined,
  tariffId: string,
  date: string,
  quantities: Record<string, number>,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<ApplyOutcome> {
  const session = await sessionOf(sessionId, deps);
  if (session === "signed_out" || session === "forbidden") return { status: session };
  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.token,
    organizationId: session.organizationId,
    path: `/v1/tariffs/${tariffId}/apply`,
    json: { date, quantities },
    schema: applyResultSchema,
    fetchFn,
  });
  if (result.ok) return { status: "ok", result: result.data };
  if (result.status === 401) return { status: "signed_out" };
  if (result.status === 403) return { status: "forbidden" };
  if (result.status === 404) return { status: "not_found" };
  if (result.status === 409) return { status: "no_version" };
  if (result.status === 400) return { status: "missing_quantity" };
  return { status: "unavailable" };
}
