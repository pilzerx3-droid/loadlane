import { Module } from "@nestjs/common";
import type pg from "pg";
import { APP_POOL } from "../../platform/tokens.ts";
import { DriverLinkController } from "./driver-link.controller.ts";
import { DriverLinkService } from "./driver-link-service.ts";
import { DRIVER_LINK_SERVICE } from "./tokens.ts";

/** Driver Link: capability links for drivers (ADR 0015). Staff-side management lives here. */
@Module({
  controllers: [DriverLinkController],
  providers: [
    {
      provide: DRIVER_LINK_SERVICE,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) => new DriverLinkService(pool),
    },
  ],
})
export class DriverLinkModule {}
