import { Module, type DynamicModule } from "@nestjs/common";
import type pg from "pg";
import { AuthGuard } from "./auth/auth.guard.ts";
import { JoseTokenVerifier } from "./auth/jose-token-verifier.ts";
import { OidcDiscovery } from "./auth/oidc-discovery.ts";
import { APP_POOL, TOKEN_VERIFIER, USER_RESOLVER } from "./auth/tokens.ts";
import { UserResolver } from "./auth/user-resolver.ts";
import { OidcUserInfoClient } from "./auth/userinfo.ts";
import type { ApiConfig } from "./config/env.ts";
import { MeController } from "./me/me.controller.ts";

export interface AppModuleOptions {
  config: Pick<ApiConfig, "oidcIssuer" | "oidcAudience">;
  /** Pool of the application role. The caller owns it and closes it on shutdown. */
  pool: pg.Pool;
  /** Tests shorten the wait before keys are refetched after a key rotation. */
  jwksCooldownMs?: number;
}

@Module({})
export class AppModule {
  static forRoot(options: AppModuleOptions): DynamicModule {
    const { config, pool } = options;
    const discovery = new OidcDiscovery(config.oidcIssuer);
    const verifier = new JoseTokenVerifier({
      issuer: config.oidcIssuer,
      audience: config.oidcAudience,
      discovery,
      ...(options.jwksCooldownMs === undefined ? {} : { jwksCooldownMs: options.jwksCooldownMs }),
    });
    const resolver = new UserResolver(pool, new OidcUserInfoClient(discovery));

    return {
      module: AppModule,
      controllers: [MeController],
      providers: [
        { provide: APP_POOL, useValue: pool },
        { provide: TOKEN_VERIFIER, useValue: verifier },
        { provide: USER_RESOLVER, useValue: resolver },
        AuthGuard,
      ],
    };
  }
}
