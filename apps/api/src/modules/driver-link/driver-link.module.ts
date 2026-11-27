import { Module } from "@nestjs/common";
import type pg from "pg";
import { APP_POOL } from "../../platform/tokens.ts";
import { DocumentsModule } from "../documents/index.ts";
import { DriverAccessService } from "./driver-access-service.ts";
import { DriverLinkController } from "./driver-link.controller.ts";
import { DriverLinkService } from "./driver-link-service.ts";
import { DriverController } from "./driver.controller.ts";
import { DRIVER_ACCESS_SERVICE, DRIVER_LINK_SERVICE } from "./tokens.ts";

/** Driver Link: capability links for drivers (ADR 0015). Staff-side management and driver-side access. */
@Module({
  imports: [DocumentsModule],
  controllers: [DriverLinkController, DriverController],
  providers: [
    {
      provide: DRIVER_LINK_SERVICE,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) => new DriverLinkService(pool),
    },
    {
      provide: DRIVER_ACCESS_SERVICE,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) => new DriverAccessService(pool),
    },
  ],
})
export class DriverLinkModule {}
