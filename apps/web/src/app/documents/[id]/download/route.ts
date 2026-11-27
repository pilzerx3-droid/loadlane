import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cookieNames } from "../../../../lib/cookies";
import { getAuthDeps } from "../../../../lib/deps";
import { fetchDocument } from "../../../../lib/documents";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hands a stored file to the signed-in person's browser. The API checks the permission and the organization. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return new NextResponse("Not found", { status: 404 });
  const deps = getAuthDeps();
  const sessionId = (await cookies()).get(cookieNames(deps.config.secureCookies).session)?.value;
  const result = await fetchDocument(sessionId, id, deps);
  if (result.status === "signed_out")
    return NextResponse.redirect(new URL("/", deps.config.appUrl));
  if (result.status === "forbidden") return new NextResponse("Forbidden", { status: 403 });
  if (result.status === "not_found") return new NextResponse("Not found", { status: 404 });
  if (result.status !== "ok") return new NextResponse("Unavailable", { status: 503 });

  const headers = new Headers();
  for (const name of [
    "content-type",
    "content-disposition",
    "content-length",
    "x-content-type-options",
    "content-security-policy",
    "cache-control",
  ]) {
    const value = result.response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(result.response.body, { status: 200, headers });
}
