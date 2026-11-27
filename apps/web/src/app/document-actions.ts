"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieNames } from "../lib/cookies";
import { getAuthDeps } from "../lib/deps";
import { deleteDocument, uploadDocument } from "../lib/documents";

// Server actions for documents. The API checks content, size, permission and organization again.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function currentSession() {
  const deps = getAuthDeps();
  const sessionId = (await cookies()).get(cookieNames(deps.config.secureCookies).session)?.value;
  return { deps, sessionId };
}

/** Uploads the chosen file to a transport. Problems come back as `?problem=document_...` on the page. */
export async function uploadDocumentAction(transportId: string, formData: FormData): Promise<void> {
  if (!UUID_PATTERN.test(transportId)) redirect("/transports");
  const file = formData.get("file");
  const type = formData.get("type");
  const { deps, sessionId } = await currentSession();
  const result = await uploadDocument(
    sessionId,
    transportId,
    file instanceof File ? file : undefined,
    typeof type === "string" ? type : "",
    deps,
  );
  if (result === "signed_out") redirect("/");
  redirect(
    result === "done"
      ? `/transports/${transportId}`
      : `/transports/${transportId}?problem=document_${result}`,
  );
}

/** Removes a document from its transport. */
export async function deleteDocumentAction(transportId: string, documentId: string): Promise<void> {
  if (!UUID_PATTERN.test(transportId) || !UUID_PATTERN.test(documentId)) redirect("/transports");
  const { deps, sessionId } = await currentSession();
  const result = await deleteDocument(sessionId, documentId, deps);
  if (result === "signed_out") redirect("/");
  redirect(
    result === "done"
      ? `/transports/${transportId}`
      : `/transports/${transportId}?problem=document_${result}`,
  );
}
