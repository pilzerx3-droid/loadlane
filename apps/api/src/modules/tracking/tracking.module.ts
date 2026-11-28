import { Module } from "@nestjs/common";
import type pg from "pg";
import { APP_POOL } from "../../platform/tokens.ts";
import { NotificationsModule } from "../notifications/index.ts";
import { TrackingController } from "./tracking.controller.ts";
import { TrackingService } from "./tracking-service.ts";
import { TRACKING_SERVICE } from "./tokens.ts";

/** Customer tracking links (ADR 0017). Driver positions are handled by the driver-link module. */
@Module({
  imports: [NotificationsModule],
  controllers: [TrackingController],
  providers: [
    {
      provide: TRACKING_SERVICE,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) => new TrackingService(pool),
    },
  ],
})
export class TrackingModule {}
