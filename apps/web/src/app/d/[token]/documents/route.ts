import { NextResponse } from "next/server";
import { getAuthDeps } from "../../../../lib/deps";
import { DRIVER_FAILURE_MESSAGES, type DriverFailure } from "../../../../lib/driver-api";

// Passes a driver's photo or document on to the API (up to 10 MB, checked by the API by content).
// A route handler instead of a server action: server actions have a small default body limit.
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;

function failure(reason: DriverFailure | "too_large" | "missing", status: number) {
  const message =
    reason === "too_large"
      ? "That file is larger than 10 MB."
      : reason === "missing"
        ? "Choose a photo or file first."
        : DRIVER_FAILURE_MESSAGES[reason];
  return NextResponse.json({ ok: false, reason, message }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return failure("rejected", 400);
  }
  const file = incoming.get("file");
  const type = incoming.get("type");
  if (!(file instanceof File) || file.size === 0) return failure("missing", 400);
  if (file.size > MAX_BYTES) return failure("too_large", 413);

  const form = new FormData();
  form.set("type", typeof type === "string" ? type : "photo");
  form.set("file", file, file.name);
  let response: Response;
  try {
    response = await fetch(`${getAuthDeps().config.apiUrl}/v1/driver/documents`, {
      method: "POST",
      headers: { "x-driver-token": token, accept: "application/json" },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return failure("unavailable", 502);
  }
  if (response.ok) return NextResponse.json({ ok: true });
  if (response.status === 404) return failure("invalid", 404);
  if (response.status === 410) {
    const problem = (await response.json().catch(() => ({}))) as { code?: unknown };
    return failure(problem.code === "driver_link_expired" ? "expired" : "revoked", 410);
  }
  if (response.status === 413) return failure("too_large", 413);
  if (response.status === 503) return failure("unavailable", 503);
  return failure("rejected", 400);
}
