import { schema, withTenant } from "@loadlane/db";
import { and, eq, isNull } from "drizzle-orm";
import type pg from "pg";

export interface MembershipRoles {
  roles: string[];
}

/** Reads what a person may do in an organization: active membership plus the roles held there. */
export class MembershipAccess {
  constructor(private readonly pool: pg.Pool) {}

  /** Undefined when the person is not an active member of a live organization. */
  async load(userId: string, organizationId: string): Promise<MembershipRoles | undefined> {
    const rows = await withTenant(this.pool, { userId, organizationId }, ({ db }) =>
      db
        .select({ role: schema.membershipRole.roleKey })
        .from(schema.membership)
        .innerJoin(
          schema.organization,
          eq(schema.organization.id, schema.membership.organizationId),
        )
        .leftJoin(
          schema.membershipRole,
          and(
            eq(schema.membershipRole.membershipId, schema.membership.id),
            eq(schema.membershipRole.organizationId, schema.membership.organizationId),
          ),
        )
        .where(
          and(
            eq(schema.membership.userId, userId),
            eq(schema.membership.organizationId, organizationId),
            eq(schema.membership.status, "active"),
            isNull(schema.organization.deletedAt),
          ),
        ),
    );
    if (rows.length === 0) return undefined;
    return { roles: rows.flatMap((row) => (row.role === null ? [] : [row.role])) };
  }
}
