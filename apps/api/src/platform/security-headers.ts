import type { NextFunction, Request, Response } from "express";

/**
 * Security headers for every API response. The API only answers JSON and file downloads to our own
 * web app, never pages, so the policy is the strictest one: nothing may be framed, loaded as a page,
 * or sniffed. Individual routes may override a header (the document download sets its own policy).
 */
export function securityHeaders() {
  return (request: Request, response: Response, next: NextFunction): void => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    response.setHeader("Cross-Origin-Resource-Policy", "same-site");
    // Responses carry private data and tokens: nothing is cached unless a route says otherwise.
    response.setHeader("Cache-Control", "no-store");
    // Tell browsers to keep using HTTPS once a response came over it (behind a proxy via the forwarded header).
    const forwarded = request.headers["x-forwarded-proto"];
    if (request.secure || forwarded === "https") {
      response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}
