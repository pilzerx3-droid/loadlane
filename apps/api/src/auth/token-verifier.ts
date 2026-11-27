/** What the API needs to know about a verified access token. Provider specific claims stay out. */
export interface VerifiedToken {
  issuer: string;
  subject: string;
  expiresAt: Date;
}

/**
 * Our own interface for access token verification (ADR 0003). The only implementation today
 * uses standard OIDC and a generic JWT library; a different provider needs no new interface.
 */
export interface TokenVerifier {
  /** Resolves for a valid token. Rejects with InvalidTokenError or ProviderUnavailableError. */
  verify(accessToken: string): Promise<VerifiedToken>;
}

export type InvalidTokenReason =
  | "malformed"
  | "expired"
  | "bad_signature"
  | "bad_issuer"
  | "bad_audience"
  | "bad_claims"
  | "unsupported_algorithm"
  | "unknown_key";

/** The token itself is not acceptable. Callers answer 401 and must not echo the reason to the client. */
export class InvalidTokenError extends Error {
  constructor(
    readonly reason: InvalidTokenReason,
    options?: ErrorOptions,
  ) {
    super(`Invalid access token: ${reason}`, options);
    this.name = "InvalidTokenError";
  }
}

/** The sign-in provider could not be reached or answered unexpectedly. Callers answer 503. */
export class ProviderUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProviderUnavailableError";
  }
}
