import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import type { OidcDiscovery } from "./oidc-discovery.ts";
import {
  InvalidTokenError,
  ProviderUnavailableError,
  type TokenVerifier,
  type VerifiedToken,
} from "./token-verifier.ts";

/** Asymmetric algorithms only. "none" and the HMAC family are never accepted. */
const ALLOWED_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
];

export interface JoseTokenVerifierOptions {
  issuer: string;
  audience: string;
  discovery: OidcDiscovery;
  /** Minimum time between key set refetches when a token names an unknown key. */
  jwksCooldownMs?: number;
  clockToleranceSeconds?: number;
}

/** Verifies JWT access tokens against the provider's published keys, using standard OIDC only. */
export class JoseTokenVerifier implements TokenVerifier {
  private keySet: ReturnType<typeof createRemoteJWKSet> | undefined;

  constructor(private readonly options: JoseTokenVerifierOptions) {}

  async verify(accessToken: string): Promise<VerifiedToken> {
    const metadata = await this.options.discovery.get();
    this.keySet ??= createRemoteJWKSet(new URL(metadata.jwksUri), {
      cooldownDuration: this.options.jwksCooldownMs ?? 30_000,
      timeoutDuration: 5000,
    });

    try {
      const { payload } = await jwtVerify(accessToken, this.keySet, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ALLOWED_ALGORITHMS,
        clockTolerance: this.options.clockToleranceSeconds ?? 30,
        requiredClaims: ["exp", "sub"],
      });
      if (
        typeof payload.sub !== "string" ||
        payload.sub.length === 0 ||
        payload.exp === undefined
      ) {
        throw new InvalidTokenError("bad_claims");
      }
      return {
        issuer: this.options.issuer,
        subject: payload.sub,
        expiresAt: new Date(payload.exp * 1000),
      };
    } catch (error) {
      throw translate(error);
    }
  }
}

function translate(error: unknown): Error {
  if (error instanceof InvalidTokenError || error instanceof ProviderUnavailableError) return error;
  if (error instanceof errors.JWTExpired) return new InvalidTokenError("expired", { cause: error });
  if (error instanceof errors.JWTClaimValidationFailed) {
    const reason =
      error.claim === "iss" ? "bad_issuer" : error.claim === "aud" ? "bad_audience" : "bad_claims";
    return new InvalidTokenError(reason, { cause: error });
  }
  if (error instanceof errors.JWSSignatureVerificationFailed) {
    return new InvalidTokenError("bad_signature", { cause: error });
  }
  if (error instanceof errors.JOSEAlgNotAllowed || error instanceof errors.JOSENotSupported) {
    return new InvalidTokenError("unsupported_algorithm", { cause: error });
  }
  if (
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JWKSMultipleMatchingKeys
  ) {
    return new InvalidTokenError("unknown_key", { cause: error });
  }
  if (error instanceof errors.JWKSTimeout) {
    return new ProviderUnavailableError("Fetching the provider's signing keys timed out", {
      cause: error,
    });
  }
  if (error instanceof errors.JOSEError) {
    // ERR_JOSE_GENERIC is what jose raises when the key set request itself fails.
    return error.code === "ERR_JOSE_GENERIC"
      ? new ProviderUnavailableError("Could not fetch the provider's signing keys", {
          cause: error,
        })
      : new InvalidTokenError("malformed", { cause: error });
  }
  // Not a jose error: with a remote key set this means the network request failed.
  return new ProviderUnavailableError("Could not fetch the provider's signing keys", {
    cause: error,
  });
}
