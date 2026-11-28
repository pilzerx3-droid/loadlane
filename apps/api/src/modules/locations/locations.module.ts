import { Module } from "@nestjs/common";
import type pg from "pg";
import { DirectoryRepository } from "../../platform/directory-repository.ts";
import { APP_POOL } from "../../platform/tokens.ts";
import { LocationController } from "./location.controller.ts";
import { LOCATION_REPOSITORY } from "./tokens.ts";

/** Places where freight is picked up or delivered. */
@Module({
  controllers: [LocationController],
  providers: [
    {
      provide: LOCATION_REPOSITORY,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) =>
        new DirectoryRepository(pool, {
          table: "location",
          fields: [
            "name",
            "addressLine1",
            "addressLine2",
            "city",
            "state",
            "postalCode",
            "timezone",
            "notes",
          ],
          readOnlyFields: ["country", "latitude", "longitude", "geocodedAt", "geocodeSource"],
          searchFields: ["name", "addressLine1", "city", "postalCode"],
        }),
    },
  ],
})
export class LocationsModule {}
