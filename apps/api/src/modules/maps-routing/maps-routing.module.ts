import { Module } from "@nestjs/common";
import type pg from "pg";
import type { GeocodingProvider } from "../../platform/geo-providers.ts";
import { APP_POOL, GEOCODING_PROVIDER } from "../../platform/tokens.ts";
import { MapsController } from "./maps.controller.ts";
import { MapsService } from "./maps-service.ts";
import { MAPS_SERVICE } from "./tokens.ts";

/** Coordinates of locations and the map of open transports (ADR 0021). */
@Module({
  controllers: [MapsController],
  providers: [
    {
      provide: MAPS_SERVICE,
      inject: [APP_POOL, GEOCODING_PROVIDER],
      useFactory: (pool: pg.Pool, geocoder: GeocodingProvider) => new MapsService(pool, geocoder),
    },
  ],
})
export class MapsRoutingModule {}
