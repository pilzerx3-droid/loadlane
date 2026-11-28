import { z } from "zod";
import { apiRequest } from "./api-client";
import { loadSession, type AuthDeps } from "./auth-routes";
import type { CalcInput } from "./calculation-form";

export const calculationSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  customer: z.object({ id: z.string(), name: z.string() }).nullable(),
  pricingMode: z.enum(["markup", "margin", "contribution", "price"]),
  costCents: z.number(),
  priceCents: z.number(),
  contributionCents: z.number(),
  markupBp: z.number().nullable(),
  marginBp: z.number().nullable(),
  createdAt: z.string(),
  createdBy: z.object({ id: z.string(), displayName: z.string() }),
});

export const calculationListSchema = z.object({
  items: z.array(calculationSummarySchema),
  page: z.object({ total: z.number().int() }),
});

export const calculationDetailSchema = calculationSummarySchema.extend({
  engineVersion: z.number(),
  lines: z.array(
    z.object({
      kind: z.string(),
      label: z.string(),
      amountCents: z.number(),
      basis: z
        .object({ rateCents: z.number(), quantityThousandths: z.number(), unit: z.string() })
        .nullable(),
    }),
  ),
  pricing: z.record(z.string(), z.union([z.string(), z.number()])),
});

export type CalculationSummary = z.infer<typeof calculationSummarySchema>;
export type CalculationDetail = z.infer<typeof calculationDetailSchema>;

export type SaveCalculationResult =
  | { status: "saved"; id: string }
  | { status: "invalid" | "forbidden" | "signed_out" | "unavailable" };

/** Saves a calculation. The API calculates again and stores the snapshot; the preview is never trusted. */
export async function saveCalculation(
  sessionId: string | undefined,
  input: CalcInput,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<SaveCalculationResult> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return { status: "signed_out" };
  const organizationId = session.activeOrganizationId;
  if (!organizationId) return { status: "forbidden" };
  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    organizationId,
    path: "/v1/calculations",
    json: input,
    schema: calculationDetailSchema,
    fetchFn,
  });
  if (result.ok) return { status: "saved", id: result.data.id };
  if (result.status === 401) return { status: "signed_out" };
  if (result.status === 403) return { status: "forbidden" };
  if (result.status === 400) return { status: "invalid" };
  deps.log(`Saving a calculation failed with HTTP ${result.status} (${result.code})`);
  return { status: "unavailable" };
}

export type DuplicateResult =
  | { status: "done"; id: string }
  | { status: "invalid" | "forbidden" | "not_found" | "signed_out" | "unavailable" };

/** Copies a calculation into a new frozen one so another price can be tried. */
export async function duplicateCalculation(
  sessionId: string | undefined,
  id: string,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<DuplicateResult> {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return { status: "signed_out" };
  const organizationId = session.activeOrganizationId;
  if (!organizationId) return { status: "forbidden" };
  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    organizationId,
    path: `/v1/calculations/${id}/duplicate`,
    json: {},
    schema: calculationDetailSchema,
    fetchFn,
  });
  if (result.ok) return { status: "done", id: result.data.id };
  if (result.status === 401) return { status: "signed_out" };
  if (result.status === 403) return { status: "forbidden" };
  if (result.status === 404) return { status: "not_found" };
  if (result.status === 400) return { status: "invalid" };
  return { status: "unavailable" };
}
