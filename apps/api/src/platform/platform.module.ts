import { Global, Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, DiscoveryModule } from "@nestjs/core";
import type pg from "pg";
import type { RuntimeConfig } from "../config/env.ts";
import { AccessDeclarationCheck } from "./access-declaration-check.ts";
import { HealthController } from "./health.ts";
import { loggerModule, type LogOptions } from "./logging.ts";
import { OpenApiController, OpenApiService } from "./openapi.ts";
import { ProblemFilter } from "./problem.ts";
import type { ObjectStorage } from "./object-storage.ts";
import { API_CONFIG, APP_POOL, OBJECT_STORAGE } from "./tokens.ts";

export interface PlatformOptions {
  config: RuntimeConfig;
  /** Pool of the application role. The caller owns it and closes it on shutdown. */
  pool: pg.Pool;
  openApiEnabled: boolean;
  log: LogOptions;
  storage: ObjectStorage;
}

/**
 * Cross-cutting parts every module may use: configuration and database pool, the error format,
 * request logging, the start-up check for access rules, and the OpenAPI document.
 */
@Global()
@Module({})
export class PlatformModule {
  static forRoot(options: PlatformOptions): DynamicModule {
    return {
      module: PlatformModule,
      imports: [DiscoveryModule, loggerModule(options.log)],
      controllers: options.openApiEnabled
        ? [OpenApiController, HealthController]
        : [HealthController],
      providers: [
        { provide: APP_POOL, useValue: options.pool },
        { provide: API_CONFIG, useValue: options.config },
        { provide: OBJECT_STORAGE, useValue: options.storage },
        { provide: APP_FILTER, useClass: ProblemFilter },
        AccessDeclarationCheck,
        ...(options.openApiEnabled ? [OpenApiService] : []),
      ],
      exports: [
        APP_POOL,
        API_CONFIG,
        OBJECT_STORAGE,
        ...(options.openApiEnabled ? [OpenApiService] : []),
      ],
    };
  }
}
