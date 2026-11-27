import { Controller, Get, Inject, Req } from "@nestjs/common";
import { schema, withTenant } from "@loadlane/db";
import { asc, eq } from "drizzle-orm";
import type pg from "pg";
import { RequirePermissions, requireTenant, type TenantRequest } from "../access/access.ts";
import { APP_POOL } from "../auth/tokens.ts";

export interface MemberResponse {
  userId: string;
  email: string;
  displayName: string;
  status: "invited" | "active" | "suspended" | "removed";
  roles: string[];
}

@Controller("v1")
export class MembersController {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  /** All memberships of the organization named in X-Organization-Id, with their roles. No paging yet (P1-08). */
  @Get("members")
  @RequirePermissions("member:read")
  async list(@Req() request: TenantRequest): Promise<{ members: MemberResponse[] }> {
    const { auth, tenant } = requireTenant(request);
    const rows = await withTenant(
      this.pool,
      { userId: auth.user.id, organizationId: tenant.organizationId },
      ({ db }) =>
        db
          .select({
            membershipId: schema.membership.id,
            userId: schema.appUser.id,
            email: schema.appUser.email,
            displayName: schema.appUser.displayName,
            status: schema.membership.status,
            role: schema.membershipRole.roleKey,
          })
          .from(schema.membership)
          .innerJoin(schema.appUser, eq(schema.appUser.id, schema.membership.userId))
          .leftJoin(
            schema.membershipRole,
            eq(schema.membershipRole.membershipId, schema.membership.id),
          )
          .where(eq(schema.membership.organizationId, tenant.organizationId))
          .orderBy(asc(schema.appUser.email), asc(schema.membershipRole.roleKey)),
    );

    const members = new Map<string, MemberResponse>();
    for (const row of rows) {
      const member = members.get(row.membershipId) ?? {
        userId: row.userId,
        email: row.email,
        displayName: row.displayName,
        status: row.status,
        roles: [],
      };
      if (row.role) member.roles.push(row.role);
      members.set(row.membershipId, member);
    }
    return { members: [...members.values()] };
  }
}
