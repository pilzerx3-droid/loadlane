import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import type pg from "pg";
import type { z } from "zod";
import { RequirePermissions } from "../../platform/access.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { APP_POOL } from "../../platform/tokens.ts";
import { ZodPipe } from "../../platform/validation.ts";
import { auditQuerySchema, auditResponseSchema, type AuditResponse } from "./audit.schemas.ts";

@Controller("v1/audit")
export class AuditController {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  @Get()
  @RequirePermissions("audit:read")
  @ApiRoute({
    summary: "Who changed what, newest first. The client address and browser are never part of it.",
    response: auditResponseSchema,
    query: auditQuerySchema,
  })
  async list(
    @Req() request: TenantRequest,
    @Query(new ZodPipe(auditQuerySchema)) query: z.output<typeof auditQuerySchema>,
  ): Promise<AuditResponse> {
    const { auth, tenant } = requireTenant(request);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.entityType) {
      params.push(query.entityType);
      conditions.push(`a.entity_type = $${params.length}`);
    }
    if (query.entityId) {
      params.push(query.entityId);
      conditions.push(`a.entity_id = $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return withTenant(
      this.pool,
      { organizationId: tenant.organizationId, userId: auth.user.id },
      async ({ client }) => {
        const total = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_log a ${where}`,
          params,
        );
        const rows = await client.query<Record<string, unknown>>(
          `SELECT a.id, a.occurred_at, a.action, a.entity_type, a.entity_id, a.changes, a.request_id,
                  a.actor_user_id, u.display_name
           FROM audit_log a LEFT JOIN app_user u ON u.id = a.actor_user_id
           ${where}
           ORDER BY a.occurred_at DESC, a.id DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, query.limit, query.offset],
        );
        return {
          items: rows.rows.map((row) => ({
            id: row["id"] as string,
            occurredAt: (row["occurred_at"] as Date).toISOString(),
            action: row["action"] as string,
            entityType: row["entity_type"] as string | null,
            entityId: row["entity_id"] as string | null,
            actor:
              row["actor_user_id"] === null
                ? null
                : {
                    id: row["actor_user_id"] as string,
                    displayName: (row["display_name"] as string | null) ?? "Unknown",
                  },
            changes: row["changes"] ?? null,
            requestId: row["request_id"] as string | null,
          })),
          page: { limit: query.limit, offset: query.offset, total: total.rows[0]?.n ?? 0 },
        };
      },
    );
  }
}
