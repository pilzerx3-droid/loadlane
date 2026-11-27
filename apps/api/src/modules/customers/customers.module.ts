import { Module } from "@nestjs/common";
import type pg from "pg";
import { DirectoryRepository } from "../../platform/directory-repository.ts";
import { APP_POOL } from "../../platform/tokens.ts";
import { CustomerController } from "./customer.controller.ts";
import { CUSTOMER_REPOSITORY } from "./tokens.ts";

/** Customers of the organization (master data). */
@Module({
  controllers: [CustomerController],
  providers: [
    {
      provide: CUSTOMER_REPOSITORY,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) =>
        new DirectoryRepository(pool, {
          table: "customer",
          fields: ["name", "contactName", "contactEmail", "contactPhone", "notes"],
          searchFields: ["name", "contactName", "contactEmail"],
        }),
    },
  ],
})
export class CustomersModule {}
