import { Module } from "@nestjs/common";
import type pg from "pg";
import { APP_POOL } from "../../platform/tokens.ts";
import { CalculationController } from "./calculation.controller.ts";
import { CalculationService } from "./calculation-service.ts";
import { CALCULATION_SERVICE } from "./tokens.ts";

/** Freight calculator: cost lines, pricing by markup, margin or contribution, frozen snapshots (ADR 0007). */
@Module({
  controllers: [CalculationController],
  providers: [
    {
      provide: CALCULATION_SERVICE,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) => new CalculationService(pool),
    },
  ],
})
export class FreightCalculatorModule {}
