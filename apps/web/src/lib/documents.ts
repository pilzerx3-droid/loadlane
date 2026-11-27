import { z } from "zod";
import { apiRequest } from "./api-client";
import { loadSession, type AuthDeps } from "./auth-routes";

export const DOCUMENT_TYPE_LABELS = {
  proof_of_delivery: "Proof of delivery",
  bill_of_lading: "Bill of lading",
  delivery_note: "Delivery note",
  photo: "Photo",
  other: "Other",
} as const;

export type DocumentType = keyof typeof DOCUMENT_TYPE_LABELS;

export const documentListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      filename: z.string(),
      contentType: z.string(),
      sizeBytes: z.number(),
      uploadedBy: z.object({ id: z.string(), displayName: z.string() }).nullable(),
      uploadedByDriver: z.boolean(),
      createdAt: z.string(),
    }),
  ),
});

export type DocumentItem = z.infer<typeof documentListSchema>["items"][number];

export function documentTypeLabel(type: string): string {
  return Object.hasOwn(DOCUMENT_TYPE_LABELS, type)
    ? DOCUMENT_TYPE_LABELS[type as DocumentType]
    : type;
}

/** "2.4 MB", "310 KB": sizes people can read. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type DocumentResult =
  | "done"
  | "unsupported"
  | "too_large"
  | "missing"
  | "storage_unavailable"
  | "forbidden"
  | "not_found"
  | "signed_out"
  | "unavailable";

async function sessionOf(sessionId: string | undefined, deps: AuthDeps) {
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return undefined;
  const organizationId = session.activeOrganizationId;
  return organizationId ? { accessToken: session.accessToken, organizationId } : undefined;
}

/** Sends a file to the API. The API checks the content, the size and the permission. */
export async function uploadDocument(
  sessionId: string | undefined,
  transportId: string,
  file: File | undefined,
  type: string,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<DocumentResult> {
  if (!file || file.size === 0) return "missing";
  const session = await sessionOf(sessionId, deps);
  if (!session) return "signed_out";

  const form = new FormData();
  form.set("type", type);
  form.set("file", file, file.name);
  let response: Response;
  try {
    response = await fetchFn(`${deps.config.apiUrl}/v1/transports/${transportId}/documents`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "x-organization-id": session.organizationId,
        accept: "application/json",
      },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return "unavailable";
  }
  if (response.ok) return "done";
  const problem = (await response.json().catch(() => ({}))) as { code?: unknown; errors?: unknown };
  if (response.status === 401) return "signed_out";
  if (response.status === 403) return "forbidden";
  if (response.status === 404) return "not_found";
  if (response.status === 413) return "too_large";
  if (response.status === 503 && problem.code === "storage_not_configured") {
    return "storage_unavailable";
  }
  if (response.status === 400) {
    const first = Array.isArray(problem.errors)
      ? (problem.errors[0] as { code?: unknown } | undefined)
      : undefined;
    return first?.code === "unsupported_file_type" ? "unsupported" : "missing";
  }
  deps.log(`Uploading a document failed with HTTP ${response.status}`);
  return "unavailable";
}

export async function deleteDocument(
  sessionId: string | undefined,
  documentId: string,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<DocumentResult> {
  const session = await sessionOf(sessionId, deps);
  if (!session) return "signed_out";
  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    organizationId: session.organizationId,
    path: `/v1/documents/${documentId}`,
    method: "DELETE",
    schema: z.object({ id: z.string() }),
    fetchFn,
  });
  if (result.ok) return "done";
  if (result.status === 401) return "signed_out";
  if (result.status === 403) return "forbidden";
  if (result.status === 404) return "not_found";
  return "unavailable";
}

/**
 * Fetches a file from the API for the person's browser. The access token never reaches the browser:
 * the web app calls the API on the person's behalf and passes the file on.
 */
export async function fetchDocument(
  sessionId: string | undefined,
  documentId: string,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<
  | { status: "ok"; response: Response }
  | { status: "signed_out" | "forbidden" | "not_found" | "unavailable" }
> {
  const session = await sessionOf(sessionId, deps);
  if (!session) return { status: "signed_out" };
  let response: Response;
  try {
    response = await fetchFn(`${deps.config.apiUrl}/v1/documents/${documentId}/download`, {
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "x-organization-id": session.organizationId,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return { status: "unavailable" };
  }
  if (response.ok) return { status: "ok", response };
  if (response.status === 401) return { status: "signed_out" };
  if (response.status === 403) return { status: "forbidden" };
  if (response.status === 404 || response.status === 400) return { status: "not_found" };
  return { status: "unavailable" };
}
