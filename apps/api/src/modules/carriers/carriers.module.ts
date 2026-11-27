import { Module } from "@nestjs/common";
import type pg from "pg";
import { DirectoryRepository } from "../../platform/directory-repository.ts";
import { APP_POOL } from "../../platform/tokens.ts";
import { CarrierController } from "./carrier.controller.ts";
import { CARRIER_REPOSITORY } from "./tokens.ts";

/** Carriers of the organization (master data). */
@Module({
  controllers: [CarrierController],
  providers: [
    {
      provide: CARRIER_REPOSITORY,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) =>
        new DirectoryRepository(pool, {
          table: "carrier",
          fields: [
            "name",
            "mcNumber",
            "dotNumber",
            "contactName",
            "contactEmail",
            "contactPhone",
            "notes",
          ],
          searchFields: ["name", "mcNumber", "dotNumber", "contactName"],
        }),
    },
  ],
})
export class CarriersModule {}
