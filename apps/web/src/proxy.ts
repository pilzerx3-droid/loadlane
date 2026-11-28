import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce } from "./lib/csp";
import { mapConfig } from "./lib/map-config";

/**
 * Sets the Content Security Policy for every page with a fresh nonce. The policy goes on the request
 * too, so Next.js puts the nonce on the scripts it adds.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = newNonce();
  // Only the map page may contact a tile server.
  const mapOrigins = request.nextUrl.pathname.startsWith("/map")
    ? mapConfig(process.env).origins
    : [];
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production", mapOrigins);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  // Pages and route handlers; not the built assets or the icon.
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
