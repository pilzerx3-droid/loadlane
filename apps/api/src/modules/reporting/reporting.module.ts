import { Module } from "@nestjs/common";
import type pg from "pg";
import { APP_POOL } from "../../platform/tokens.ts";
import { ReportController } from "./report.controller.ts";
import { ReportService } from "./report-service.ts";
import { REPORT_SERVICE } from "./tokens.ts";

/** Reporting: figures computed from stored data only. */
@Module({
  controllers: [ReportController],
  providers: [
    {
      provide: REPORT_SERVICE,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) => new ReportService(pool),
    },
  ],
})
export class ReportingModule {}
