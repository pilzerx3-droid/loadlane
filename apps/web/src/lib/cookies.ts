export interface CookieNames {
  session: string;
  login: string;
}

/** With https the cookies get the __Host- prefix: the browser then requires Secure, Path=/ and no Domain. */
export function cookieNames(secure: boolean): CookieNames {
  const prefix = secure ? "__Host-" : "";
  return { session: `${prefix}ll_session`, login: `${prefix}ll_login` };
}

/** Builds a Set-Cookie value. Always HttpOnly, SameSite=Lax and Path=/. */
export function serializeCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds: number; secure: boolean },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(name: string, secure: boolean): string {
  return serializeCookie(name, "", { maxAgeSeconds: 0, secure });
}

/** Reads one cookie from a Cookie request header. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
