/**
 * The Content Security Policy of the web app, built per request with a fresh nonce. Scripts run only
 * when they carry the nonce (or were started by such a script), so injected markup cannot execute.
 * Development needs `unsafe-eval` for React's tooling; production does not.
 */
export function buildCsp(
  nonce: string,
  development: boolean,
  /** Hosts the map page may load tiles, sprites and fonts from. Empty on every other page. */
  mapOrigins: readonly string[] = [],
): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(development ? ["'unsafe-eval'"] : []),
    ],
    // Tailwind and Next emit style attributes; styles cannot run code.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...mapOrigins],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...mapOrigins],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    // The map draws in a web worker that MapLibre starts from a blob.
    ...(mapOrigins.length > 0 ? { "worker-src": ["'self'", "blob:"] } : {}),
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/** A random value for one response, base64 so it is safe inside a header. */
export function newNonce(): string {
  return btoa(crypto.randomUUID());
}
