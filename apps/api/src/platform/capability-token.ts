import { createHash, randomBytes } from "node:crypto";

/** A new secret for a capability link: 256 random bits, URL safe. Shown once, never stored. */
export function newCapabilityToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex of a token: the only form in which capability tokens are stored or looked up. */
export function hashCapabilityToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
