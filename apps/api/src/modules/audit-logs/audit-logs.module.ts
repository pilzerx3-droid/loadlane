import { Module } from "@nestjs/common";

/** Audit logs. Planned for a later phase. The audit_log table exists (ADR 0002); reading it through the API is not built yet. Intentionally empty: no code until its phase starts. */
@Module({})
export class AuditLogsModule {}
