import { Module, type DynamicModule } from "@nestjs/common";
import { APP_GUARD, DiscoveryModule } from "@nestjs/core";
import type pg from "pg";
import { AccessDeclarationCheck } from "./access/access-declaration-check.ts";
import { AccessGuard } from "./access/access.guard.ts";
import { MembershipAccess } from "./access/membership-access.ts";
import { Authenticator } from "./auth/authenticator.ts";
import { JoseTokenVerifier } from "./auth/jose-token-verifier.ts";
import { OidcDiscovery } from "./auth/oidc-discovery.ts";
import { APP_POOL, AUTHENTICATOR, MEMBERSHIP_ACCESS } from "./auth/tokens.ts";
import { UserResolver } from "./auth/user-resolver.ts";
import { OidcUserInfoClient } from "./auth/userinfo.ts";
import type { ApiConfig } from "./config/env.ts";
import { MeController } from "./me/me.controller.ts";
import { MembersController } from "./members/members.controller.ts";
import { OrganizationController } from "./organization/organization.controller.ts";

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
      imports: [DiscoveryModule],
      controllers: [MeController, OrganizationController, MembersController],
      providers: [
        { provide: APP_POOL, useValue: pool },
        { provide: AUTHENTICATOR, useValue: new Authenticator(verifier, resolver) },
        { provide: MEMBERSHIP_ACCESS, useValue: new MembershipAccess(pool) },
        // Every route passes through AccessGuard; routes without an access rule are refused.
        { provide: APP_GUARD, useClass: AccessGuard },
        AccessDeclarationCheck,
      ],
    };
  }
}
