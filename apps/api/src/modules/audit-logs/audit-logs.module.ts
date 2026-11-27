import { Module } from "@nestjs/common";
import { AuditController } from "./audit.controller.ts";

/** Read access to the audit trail. Entries are written by the modules that change data. */
@Module({ controllers: [AuditController] })
export class AuditLogsModule {}
