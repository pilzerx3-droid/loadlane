import * as client from "openid-client";
import type { WebConfig } from "./config";
import type { PendingLogin } from "./session-store";

/** What we keep from the provider's token response. */
export interface TokenSet {
  accessToken: string;
  /** Epoch seconds. */
  accessTokenExpiresAt: number;
  refreshToken?: string | undefined;
  idToken?: string | undefined;
  subject: string;
}

/**
 * Our own interface for the browser sign-in flow (ADR 0003): Authorization Code with PKCE and nothing
 * provider specific. Route handlers depend on this, not on a library.
 */
export interface OidcFlow {
  start(): Promise<{ authorizationUrl: URL; pending: PendingLogin }>;
  /** Exchanges the callback for tokens. Verifies state, nonce, PKCE and the ID token. */
  complete(callbackUrl: URL, pending: PendingLogin): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<Omit<TokenSet, "subject">>;
  /** The provider's end-session URL, or undefined when the provider has none. */
  logoutUrl(idToken: string | undefined): Promise<URL | undefined>;
}

const SCOPES = "openid profile email offline_access";
const DEFAULT_LIFETIME_SECONDS = 300;

function expiresAt(expiresIn: number | undefined): number {
  return Math.floor(Date.now() / 1000) + (expiresIn ?? DEFAULT_LIFETIME_SECONDS);
}

/** Public client with PKCE: there is no client secret to protect. */
export class OpenIdClientFlow implements OidcFlow {
  private configuration: Promise<client.Configuration> | undefined;

  constructor(
    private readonly config: Pick<
      WebConfig,
      "oidcIssuer" | "oidcClientId" | "callbackUrl" | "postLogoutUrl"
    >,
  ) {}

  async start(): Promise<{ authorizationUrl: URL; pending: PendingLogin }> {
    const configuration = await this.load();
    const codeVerifier = client.randomPKCECodeVerifier();
    const pending: PendingLogin = {
      state: client.randomState(),
      nonce: client.randomNonce(),
      codeVerifier,
    };
    const authorizationUrl = client.buildAuthorizationUrl(configuration, {
      redirect_uri: this.config.callbackUrl.href,
      scope: SCOPES,
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
      state: pending.state,
      nonce: pending.nonce,
    });
    return { authorizationUrl, pending };
  }

  async complete(callbackUrl: URL, pending: PendingLogin): Promise<TokenSet> {
    const configuration = await this.load();
    const tokens = await client.authorizationCodeGrant(configuration, callbackUrl, {
      pkceCodeVerifier: pending.codeVerifier,
      expectedState: pending.state,
      expectedNonce: pending.nonce,
      idTokenExpected: true,
    });
    const subject = tokens.claims()?.sub;
    if (!subject) throw new Error("The provider returned no ID token subject");
    return {
      accessToken: tokens.access_token,
      accessTokenExpiresAt: expiresAt(tokens.expires_in),
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      subject,
    };
  }

  async refresh(refreshToken: string): Promise<Omit<TokenSet, "subject">> {
    const configuration = await this.load();
    const tokens = await client.refreshTokenGrant(configuration, refreshToken);
    return {
      accessToken: tokens.access_token,
      accessTokenExpiresAt: expiresAt(tokens.expires_in),
      // Providers may rotate the refresh token; keep the old one when no new one is sent.
      refreshToken: tokens.refresh_token ?? refreshToken,
      idToken: tokens.id_token,
    };
  }

  async logoutUrl(idToken: string | undefined): Promise<URL | undefined> {
    const configuration = await this.load();
    if (!configuration.serverMetadata().end_session_endpoint) return undefined;
    return client.buildEndSessionUrl(configuration, {
      client_id: this.config.oidcClientId,
      post_logout_redirect_uri: this.config.postLogoutUrl.href,
      ...(idToken ? { id_token_hint: idToken } : {}),
    });
  }

  private load(): Promise<client.Configuration> {
    this.configuration ??= client
      .discovery(
        new URL(this.config.oidcIssuer),
        this.config.oidcClientId,
        undefined,
        client.None(),
        this.config.oidcIssuer.startsWith("http:")
          ? { execute: [client.allowInsecureRequests] }
          : undefined,
      )
      .catch((error: unknown) => {
        // Do not cache a failure: the provider may be back on the next request.
        this.configuration = undefined;
        throw error;
      });
    return this.configuration;
  }
}
