import { Module } from "@nestjs/common";
import type pg from "pg";
import type { RoutingProvider } from "../../platform/geo-providers.ts";
import { APP_POOL, ROUTING_PROVIDER } from "../../platform/tokens.ts";
import { EtaController } from "./eta.controller.ts";
import { EtaService } from "./eta-service.ts";
import { ETA_SERVICE } from "./tokens.ts";

/** Estimated arrival from a routing provider (ADR 0021). Position intake asks it for a refresh. */
@Module({
  controllers: [EtaController],
  providers: [
    {
      provide: ETA_SERVICE,
      inject: [APP_POOL, ROUTING_PROVIDER],
      useFactory: (pool: pg.Pool, routing: RoutingProvider) => new EtaService(pool, routing),
    },
  ],
  exports: [ETA_SERVICE],
})
export class EtaEngineModule {}
