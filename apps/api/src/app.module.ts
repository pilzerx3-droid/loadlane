import { Module, type DynamicModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule, type ThrottlerStorage } from "@nestjs/throttler";
import type pg from "pg";
import type { RuntimeConfig } from "./config/env.ts";
import { AuthenticationModule } from "./modules/authentication/index.ts";
import { LocationsModule } from "./modules/locations/index.ts";
import { OrganizationsModule } from "./modules/organizations/index.ts";
import { PLANNED_MODULES } from "./modules/planned-modules.ts";
import { AccessGuard, UsersPermissionsModule } from "./modules/users-permissions/index.ts";
import type { LogOptions } from "./platform/logging.ts";
import {
  UnconfiguredGeocodingProvider,
  UnconfiguredRoutingProvider,
  type GeocodingProvider,
  type RoutingProvider,
} from "./platform/geo-providers.ts";
import { UnconfiguredMailProvider, type MailProvider } from "./platform/mail.ts";
import { UnconfiguredObjectStorage, type ObjectStorage } from "./platform/object-storage.ts";
import { PlatformModule } from "./platform/platform.module.ts";
import { RateLimitGuard } from "./platform/rate-limit.ts";

export interface AppModuleOptions {
  config: RuntimeConfig;
  /** Pool of the application role. The caller owns it and closes it on shutdown. */
  pool: pg.Pool;
  /** Tests shorten the wait before keys are refetched after a key rotation. */
  jwksCooldownMs?: number;
  /** Default: 120 requests per client address and minute. */
  rateLimit?: { limit: number; windowMs: number };
  /** Default: counted in memory of this instance. Pass a shared store to limit across instances. */
  rateLimitStorage?: ThrottlerStorage;
  /** Default: on. Whether GET /v1/openapi.json is served. */
  openApiEnabled?: boolean;
  /** Default: level info, standard output. */
  log?: LogOptions;
  /** Default: storage that answers 503. */
  storage?: ObjectStorage;
  /** Default: a provider that answers 503 (mail_not_configured). */
  mail?: MailProvider;
  /** Default: answers 503 (geocoding_not_configured). */
  geocoding?: GeocodingProvider;
  /** Default: answers 503 (routing_not_configured). */
  routing?: RoutingProvider;
}

export function withDefaults(options: AppModuleOptions) {
  return {
    ...options,
    rateLimit: options.rateLimit ?? { limit: 120, windowMs: 60_000 },
    openApiEnabled: options.openApiEnabled ?? true,
    log: options.log ?? { level: "info" },
    storage: options.storage ?? new UnconfiguredObjectStorage(),
    mail: options.mail ?? new UnconfiguredMailProvider(),
    geocoding: options.geocoding ?? new UnconfiguredGeocodingProvider(),
    routing: options.routing ?? new UnconfiguredRoutingProvider(),
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
          storage: options.storage,
          mail: options.mail,
          geocoding: options.geocoding,
          routing: options.routing,
        }),
        ThrottlerModule.forRoot({
          throttlers: [
            { name: "default", ttl: options.rateLimit.windowMs, limit: options.rateLimit.limit },
          ],
          errorMessage: "Too many requests. Please slow down and retry later.",
          ...(options.rateLimitStorage ? { storage: options.rateLimitStorage } : {}),
        }),
        AuthenticationModule.register(
          options.jwksCooldownMs === undefined ? {} : { jwksCooldownMs: options.jwksCooldownMs },
        ),
        UsersPermissionsModule,
        OrganizationsModule,
        LocationsModule,
        ...PLANNED_MODULES,
      ],
      providers: [
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useClass: AccessGuard },
      ],
    };
  }
}
