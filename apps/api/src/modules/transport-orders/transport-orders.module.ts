import { Module } from "@nestjs/common";
import type pg from "pg";
import { APP_POOL } from "../../platform/tokens.ts";
import { TransportController } from "./transport.controller.ts";
import { TransportService } from "./transport-service.ts";
import { TransportImporter } from "./transport-import.ts";
import { TRANSPORT_IMPORTER, TRANSPORT_SERVICE } from "./tokens.ts";

/** Transports with stops, status model and event history (ADR 0014). */
@Module({
  controllers: [TransportController],
  providers: [
    {
      provide: TRANSPORT_SERVICE,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) => new TransportService(pool),
    },
    {
      provide: TRANSPORT_IMPORTER,
      inject: [APP_POOL, TRANSPORT_SERVICE],
      useFactory: (pool: pg.Pool, service: TransportService) =>
        new TransportImporter(pool, service),
    },
  ],
})
export class TransportOrdersModule {}
