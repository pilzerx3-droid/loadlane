import { z } from "zod";
import { ProviderUnavailableError } from "./token-verifier.ts";

export interface OidcMetadata {
  issuer: string;
  jwksUri: string;
  userinfoEndpoint: string | undefined;
}

const metadataSchema = z.object({
  issuer: z.string(),
  jwks_uri: z.url(),
  userinfo_endpoint: z.url().optional(),
});

/**
 * Reads the provider's OIDC discovery document once and keeps it for the life of the process.
 * Failures are not cached, so the API recovers when the provider comes back.
 */
export class OidcDiscovery {
  private cached: OidcMetadata | undefined;
  private inflight: Promise<OidcMetadata> | undefined;

  constructor(
    private readonly issuer: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 5000,
  ) {}

  get(): Promise<OidcMetadata> {
    if (this.cached) return Promise.resolve(this.cached);
    this.inflight ??= this.load()
      .then((metadata) => {
        this.cached = metadata;
        return metadata;
      })
      .finally(() => {
        this.inflight = undefined;
      });
    return this.inflight;
  }

  private async load(): Promise<OidcMetadata> {
    const url = `${this.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
    let body: unknown;
    try {
      const response = await this.fetchFn(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      body = await response.json();
    } catch (error) {
      throw new ProviderUnavailableError(`Could not read the OIDC discovery document at ${url}`, {
        cause: error,
      });
    }
    const parsed = metadataSchema.safeParse(body);
    if (!parsed.success) {
      throw new ProviderUnavailableError(`The OIDC discovery document at ${url} is not valid`);
    }
    if (parsed.data.issuer !== this.issuer) {
      // Protects against pointing OIDC_ISSUER at the wrong provider or tenant.
      throw new ProviderUnavailableError(
        `The discovery document names issuer ${parsed.data.issuer}, expected ${this.issuer}`,
      );
    }
    return {
      issuer: parsed.data.issuer,
      jwksUri: parsed.data.jwks_uri,
      userinfoEndpoint: parsed.data.userinfo_endpoint,
    };
  }
}
