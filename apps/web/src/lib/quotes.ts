import { z } from "zod";
import { apiRequest } from "./api-client";
import { loadSession, type AuthDeps } from "./auth-routes";

export const quoteSummarySchema = z.object({
  id: z.string(),
  number: z.number(),
  reference: z.string(),
  status: z.string(),
  expired: z.boolean(),
  customer: z.object({ id: z.string(), name: z.string() }),
  calculationName: z.string(),
  priceCents: z.number(),
  validUntil: z.string(),
  createdAt: z.string(),
});

export const quoteListSchema = z.object({
  items: z.array(quoteSummarySchema),
  page: z.object({ total: z.number().int() }),
});

export const quoteDetailSchema = quoteSummarySchema.extend({
  allowedStatuses: z.array(z.string()),
  editable: z.boolean(),
  terms: z.string().nullable(),
  notes: z.string().nullable(),
  sentAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdBy: z.object({ id: z.string(), displayName: z.string() }),
  calculation: z.object({
    id: z.string(),
    costCents: z.number(),
    contributionCents: z.number(),
    markupBp: z.number().nullable(),
    marginBp: z.number().nullable(),
  }),
});

export type QuoteSummary = z.infer<typeof quoteSummarySchema>;
export type QuoteDetail = z.infer<typeof quoteDetailSchema>;

export type QuoteResult =
  | { status: "done"; id: string }
  | {
      status:
        | "invalid"
        | "needs_customer"
        | "not_editable"
        | "expired"
        | "invalid_transition"
        | "forbidden"
        | "not_found"
        | "signed_out"
        | "unavailable";
    };

async function call(
  sessionId: string | undefined,
  deps: AuthDeps,
  path: string,
  json: unknown,
  method: "POST" | "PATCH",
  fetchFn: typeof fetch,
): Promise<QuoteResult> {
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
    schema: quoteDetailSchema,
    fetchFn,
  });
  if (result.ok) return { status: "done", id: result.data.id };
  if (result.status === 401) return { status: "signed_out" };
  if (result.status === 403) return { status: "forbidden" };
  if (result.status === 404) return { status: "not_found" };
  if (result.status === 409) {
    if (result.code === "quote_not_editable") return { status: "not_editable" };
    if (result.code === "quote_expired") return { status: "expired" };
    return { status: "invalid_transition" };
  }
  if (result.status === 400) {
    const needsCustomer = result.errors.some(
      (error) => error.path === "customerId" && error.code === "required",
    );
    return { status: needsCustomer ? "needs_customer" : "invalid" };
  }
  deps.log(`A quote call failed with HTTP ${result.status} (${result.code})`);
  return { status: "unavailable" };
}

export interface NewQuote {
  calculationId: string;
  customerId: string;
  validUntil: string;
  terms: string;
  notes: string;
}

export function createQuote(
  sessionId: string | undefined,
  quote: NewQuote,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<QuoteResult> {
  return call(
    sessionId,
    deps,
    "/v1/quotes",
    {
      calculationId: quote.calculationId,
      ...(quote.customerId === "" ? {} : { customerId: quote.customerId }),
      validUntil: quote.validUntil,
      terms: quote.terms,
      notes: quote.notes,
    },
    "POST",
    fetchFn,
  );
}

export function updateQuote(
  sessionId: string | undefined,
  id: string,
  patch: { validUntil: string; terms: string; notes: string },
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<QuoteResult> {
  return call(sessionId, deps, `/v1/quotes/${id}`, patch, "PATCH", fetchFn);
}

export function changeQuoteStatus(
  sessionId: string | undefined,
  id: string,
  status: string,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<QuoteResult> {
  return call(sessionId, deps, `/v1/quotes/${id}/status`, { status }, "POST", fetchFn);
}
