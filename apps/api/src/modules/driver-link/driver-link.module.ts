import { Module } from "@nestjs/common";
import type pg from "pg";
import { APP_POOL } from "../../platform/tokens.ts";
import { DocumentsModule } from "../documents/index.ts";
import { ETA_SERVICE, EtaEngineModule, type EtaService } from "../eta-engine/index.ts";
import { DriverAccessService } from "./driver-access-service.ts";
import { DriverLinkController } from "./driver-link.controller.ts";
import { DriverLinkService } from "./driver-link-service.ts";
import { DriverController } from "./driver.controller.ts";
import { DRIVER_ACCESS_SERVICE, DRIVER_LINK_SERVICE } from "./tokens.ts";

/** Driver Link: capability links for drivers (ADR 0015). Staff-side management and driver-side access. */
@Module({
  imports: [DocumentsModule, EtaEngineModule],
  controllers: [DriverLinkController, DriverController],
  providers: [
    {
      provide: DRIVER_LINK_SERVICE,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) => new DriverLinkService(pool),
    },
    {
      provide: DRIVER_ACCESS_SERVICE,
      inject: [APP_POOL, ETA_SERVICE],
      useFactory: (pool: pg.Pool, eta: EtaService) =>
        // After a position is stored the estimated arrival is refreshed in the background: the driver
        // never waits for the routing provider, and a failure there never fails the position.
        new DriverAccessService(pool, (organizationId, transportId) => {
          void eta.refresh(organizationId, transportId).catch(() => undefined);
        }),
    },
  ],
})
export class DriverLinkModule {}
