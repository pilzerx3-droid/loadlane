import { Module } from "@nestjs/common";
import type pg from "pg";
import { APP_POOL } from "../../platform/tokens.ts";
import { TariffController } from "./tariff.controller.ts";
import { TariffService } from "./tariff-service.ts";
import { TARIFF_SERVICE } from "./tokens.ts";

/** Pricing and tariffs: price lists with immutable dated versions (ADR 0007). */
@Module({
  controllers: [TariffController],
  providers: [
    {
      provide: TARIFF_SERVICE,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) => new TariffService(pool),
    },
  ],
})
export class PricingTariffsModule {}
