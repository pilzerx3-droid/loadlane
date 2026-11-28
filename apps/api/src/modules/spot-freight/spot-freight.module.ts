import { Module } from "@nestjs/common";
import type pg from "pg";
import { APP_POOL } from "../../platform/tokens.ts";
import { SpotCarrierController, SpotController } from "./spot.controller.ts";
import { SpotCarrierService } from "./spot-carrier-service.ts";
import { SpotService } from "./spot-service.ts";
import { SPOT_CARRIER_SERVICE, SPOT_SERVICE } from "./tokens.ts";

/** Spot freight (ADR 0019): offer a transport to chosen carriers, take bids, award. */
@Module({
  controllers: [SpotController, SpotCarrierController],
  providers: [
    {
      provide: SPOT_SERVICE,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) => new SpotService(pool),
    },
    {
      provide: SPOT_CARRIER_SERVICE,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) => new SpotCarrierService(pool),
    },
  ],
})
export class SpotFreightModule {}
