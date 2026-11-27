import { z } from "zod";
import { apiRequest } from "./api-client";
import { loadSession, type AuthDeps } from "./auth-routes";

export const importReportSchema = z.object({
  status: z.enum(["preview", "imported", "rejected"]),
  fileProblems: z.array(z.string()),
  rows: z.array(z.object({ line: z.number(), problems: z.array(z.string()) })),
  summary: z.object({ total: z.number(), valid: z.number(), failed: z.number() }),
  created: z.array(z.string()),
});

export type ImportReport = z.infer<typeof importReportSchema>;

export type ImportResult =
  | { status: "ok"; report: ImportReport }
  | { status: "too_large" | "forbidden" | "signed_out" | "unavailable" };

/** The API accepts at most this many characters of CSV text. */
export const MAX_CSV_CHARACTERS = 90_000;

/** Checks (`dryRun`) or imports a CSV file of transports. The API decides everything; this only passes it on. */
export async function importTransports(
  sessionId: string | undefined,
  csv: string,
  dryRun: boolean,
  deps: AuthDeps,
  fetchFn: typeof fetch = fetch,
): Promise<ImportResult> {
  if (csv.length > MAX_CSV_CHARACTERS) return { status: "too_large" };
  const session = await loadSession(sessionId, deps);
  if (!sessionId || !session) return { status: "signed_out" };
  const organizationId = session.activeOrganizationId;
  if (!organizationId) return { status: "forbidden" };

  const result = await apiRequest({
    apiUrl: deps.config.apiUrl,
    accessToken: session.accessToken,
    organizationId,
    path: "/v1/transports/import",
    json: { csv, dryRun },
    schema: importReportSchema,
    fetchFn,
  });
  if (result.ok) return { status: "ok", report: result.data };
  if (result.status === 401) return { status: "signed_out" };
  if (result.status === 403) return { status: "forbidden" };
  if (result.status === 400) return { status: "too_large" };
  deps.log(`Importing transports failed with HTTP ${result.status} (${result.code})`);
  return { status: "unavailable" };
}
