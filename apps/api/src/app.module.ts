import { Module, type DynamicModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import type pg from "pg";
import type { ApiConfig } from "./config/env.ts";
import { AuthenticationModule } from "./modules/authentication/index.ts";
import { OrganizationsModule } from "./modules/organizations/index.ts";
import { PLANNED_MODULES } from "./modules/planned-modules.ts";
import { AccessGuard, UsersPermissionsModule } from "./modules/users-permissions/index.ts";
import type { LogOptions } from "./platform/logging.ts";
import { PlatformModule } from "./platform/platform.module.ts";
import { RateLimitGuard } from "./platform/rate-limit.ts";

export interface AppModuleOptions {
  config: Pick<ApiConfig, "oidcIssuer" | "oidcAudience">;
  /** Pool of the application role. The caller owns it and closes it on shutdown. */
  pool: pg.Pool;
  /** Tests shorten the wait before keys are refetched after a key rotation. */
  jwksCooldownMs?: number;
  /** Default: 120 requests per client address and minute. */
  rateLimit?: { limit: number; windowMs: number };
  /** Default: on. Whether GET /v1/openapi.json is served. */
  openApiEnabled?: boolean;
  /** Default: level info, standard output. */
  log?: LogOptions;
}

export function withDefaults(options: AppModuleOptions) {
  return {
    ...options,
    rateLimit: options.rateLimit ?? { limit: 120, windowMs: 60_000 },
    openApiEnabled: options.openApiEnabled ?? true,
    log: options.log ?? { level: "info" },
  };
}

/**
 * Composition root. The order of the global guards matters and is decided here: the rate limit comes
 * first (so that requests with invalid tokens are limited too), the access check second.
 */
@Module({})
export class AppModule {
  static forRoot(input: AppModuleOptions): DynamicModule {
    const options = withDefaults(input);
    return {
      module: AppModule,
      imports: [
        PlatformModule.forRoot({
          config: options.config,
          pool: options.pool,
          openApiEnabled: options.openApiEnabled,
          log: options.log,
        }),
        ThrottlerModule.forRoot({
          throttlers: [
            { name: "default", ttl: options.rateLimit.windowMs, limit: options.rateLimit.limit },
          ],
          errorMessage: "Too many requests. Please slow down and retry later.",
        }),
        AuthenticationModule.register(
          options.jwksCooldownMs === undefined ? {} : { jwksCooldownMs: options.jwksCooldownMs },
        ),
        UsersPermissionsModule,
        OrganizationsModule,
        ...PLANNED_MODULES,
      ],
      providers: [
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useClass: AccessGuard },
      ],
    };
  }
}
