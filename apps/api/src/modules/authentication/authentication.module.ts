import { Module, type DynamicModule } from "@nestjs/common";
import type pg from "pg";
import type { ApiConfig } from "../../config/env.ts";
import { API_CONFIG, APP_POOL } from "../../platform/tokens.ts";
import { Authenticator } from "./authenticator.ts";
import { JoseTokenVerifier } from "./jose-token-verifier.ts";
import { MeController } from "./me.controller.ts";
import { OidcDiscovery } from "./oidc-discovery.ts";
import { AUTHENTICATOR, OIDC_DISCOVERY, TOKEN_VERIFIER, USER_RESOLVER } from "./tokens.ts";
import type { TokenVerifier } from "./token-verifier.ts";
import { UserResolver } from "./user-resolver.ts";
import { OidcUserInfoClient } from "./userinfo.ts";

type OidcConfig = Pick<ApiConfig, "oidcIssuer" | "oidcAudience">;

/** Sign-in: verifies access tokens (standard OIDC, ADR 0003) and maps them to our users. */
@Module({})
export class AuthenticationModule {
  static register(options: { jwksCooldownMs?: number } = {}): DynamicModule {
    return {
      module: AuthenticationModule,
      controllers: [MeController],
      providers: [
        {
          provide: OIDC_DISCOVERY,
          inject: [API_CONFIG],
          useFactory: (config: OidcConfig) => new OidcDiscovery(config.oidcIssuer),
        },
        {
          provide: TOKEN_VERIFIER,
          inject: [API_CONFIG, OIDC_DISCOVERY],
          useFactory: (config: OidcConfig, discovery: OidcDiscovery) =>
            new JoseTokenVerifier({
              issuer: config.oidcIssuer,
              audience: config.oidcAudience,
              discovery,
              ...(options.jwksCooldownMs === undefined
                ? {}
                : { jwksCooldownMs: options.jwksCooldownMs }),
            }),
        },
        {
          provide: USER_RESOLVER,
          inject: [APP_POOL, OIDC_DISCOVERY],
          useFactory: (pool: pg.Pool, discovery: OidcDiscovery) =>
            new UserResolver(pool, new OidcUserInfoClient(discovery)),
        },
        {
          provide: AUTHENTICATOR,
          inject: [TOKEN_VERIFIER, USER_RESOLVER],
          useFactory: (verifier: TokenVerifier, resolver: UserResolver) =>
            new Authenticator(verifier, resolver),
        },
      ],
      exports: [AUTHENTICATOR],
    };
  }
}
