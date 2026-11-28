"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieNames } from "../lib/cookies";
import { getAuthDeps } from "../lib/deps";
import {
  changeQuoteStatus,
  createQuote,
  emailQuote,
  updateQuote,
  type QuoteResult,
} from "../lib/quotes";

// Server actions for quotes. The API checks permission, status rules and dates again.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function currentSession() {
  const deps = getAuthDeps();
  const sessionId = (await cookies()).get(cookieNames(deps.config.secureCookies).session)?.value;
  return { deps, sessionId };
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function finish(result: QuoteResult, okPath: (id: string) => string, failPath: string): never {
  if (result.status === "signed_out") redirect("/");
  if (result.status === "done") redirect(okPath(result.id));
  redirect(`${failPath}${failPath.includes("?") ? "&" : "?"}problem=${result.status}`);
}

/** Creates a draft quote from a calculation. Problems come back as `?problem=` on the form. */
export async function createQuoteAction(formData: FormData): Promise<void> {
  const calculationId = text(formData, "calculationId");
  if (!UUID_PATTERN.test(calculationId)) redirect("/calculations");
  const validUntil = text(formData, "validUntil");
  const failPath = `/quotes/new?calculation=${calculationId}`;
  if (!DATE_PATTERN.test(validUntil)) redirect(`${failPath}&problem=invalid`);
  const { deps, sessionId } = await currentSession();
  const result = await createQuote(
    sessionId,
    {
      calculationId,
      customerId: text(formData, "customerId"),
      validUntil,
      terms: text(formData, "terms"),
      notes: text(formData, "notes"),
    },
    deps,
  );
  finish(result, (id) => `/quotes/${id}`, failPath);
}

export async function updateQuoteAction(id: string, formData: FormData): Promise<void> {
  if (!UUID_PATTERN.test(id)) redirect("/quotes");
  const validUntil = text(formData, "validUntil");
  if (!DATE_PATTERN.test(validUntil)) redirect(`/quotes/${id}?problem=invalid`);
  const { deps, sessionId } = await currentSession();
  const result = await updateQuote(
    sessionId,
    id,
    { validUntil, terms: text(formData, "terms"), notes: text(formData, "notes") },
    deps,
  );
  finish(result, (done) => `/quotes/${done}`, `/quotes/${id}`);
}

export async function changeQuoteStatusAction(id: string, formData: FormData): Promise<void> {
  if (!UUID_PATTERN.test(id)) redirect("/quotes");
  const { deps, sessionId } = await currentSession();
  const result = await changeQuoteStatus(sessionId, id, text(formData, "status"), deps);
  finish(result, (done) => `/quotes/${done}`, `/quotes/${id}`);
}

/** E-mails the quote PDF. Success comes back as `?notice=emailed`, problems as `?problem=`. */
export async function emailQuoteAction(id: string, formData: FormData): Promise<void> {
  if (!UUID_PATTERN.test(id)) redirect("/quotes");
  const { deps, sessionId } = await currentSession();
  const result = await emailQuote(sessionId, id, text(formData, "to"), deps);
  if (result.status === "signed_out") redirect("/");
  redirect(
    result.status === "sent"
      ? `/quotes/${id}?notice=emailed`
      : `/quotes/${id}?problem=${result.status}`,
  );
}
