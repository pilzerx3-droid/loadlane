import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { schema, withTenant } from "@loadlane/db";
import { asc, count, eq, inArray } from "drizzle-orm";
import type pg from "pg";
import { z } from "zod";
import { RequirePermissions } from "../../platform/access.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { APP_POOL } from "../../platform/tokens.ts";
import { ZodPipe } from "../../platform/validation.ts";

export const membersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50).describe("Page size"),
  offset: z.coerce.number().int().min(0).default(0).describe("Number of entries to skip"),
});

export const membersResponseSchema = z.object({
  members: z.array(
    z.object({
      userId: z.uuid(),
      email: z.string(),
      displayName: z.string(),
      status: z.enum(["invited", "active", "suspended", "removed"]),
      roles: z.array(z.string()),
    }),
  ),
  page: z.object({
    limit: z.number().int(),
    offset: z.number().int(),
    total: z.number().int().describe("Memberships of the organization in all statuses"),
  }),
});

export type MembersResponse = z.infer<typeof membersResponseSchema>;

@Controller("v1")
export class MembersController {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  @Get("members")
  @RequirePermissions("member:read")
  @ApiRoute({
    summary: "Memberships of the organization with their roles, sorted by e-mail address",
    response: membersResponseSchema,
    query: membersQuerySchema,
  })
  async list(
    @Req() request: TenantRequest,
    @Query(new ZodPipe(membersQuerySchema)) query: z.output<typeof membersQuerySchema>,
  ): Promise<MembersResponse> {
    const { auth, tenant } = requireTenant(request);
    const { limit, offset } = query;

    const { total, rows, roleRows } = await withTenant(
      this.pool,
      { userId: auth.user.id, organizationId: tenant.organizationId },
      async ({ db }) => {
        const inOrganization = eq(schema.membership.organizationId, tenant.organizationId);
        const [totalRow] = await db
          .select({ total: count() })
          .from(schema.membership)
          .where(inOrganization);
        const rows = await db
          .select({
            membershipId: schema.membership.id,
            userId: schema.appUser.id,
            email: schema.appUser.email,
            displayName: schema.appUser.displayName,
            status: schema.membership.status,
          })
          .from(schema.membership)
          .innerJoin(schema.appUser, eq(schema.appUser.id, schema.membership.userId))
          .where(inOrganization)
          .orderBy(asc(schema.appUser.email), asc(schema.membership.id))
          .limit(limit)
          .offset(offset);
        const roleRows =
          rows.length === 0
            ? []
            : await db
                .select({
                  membershipId: schema.membershipRole.membershipId,
                  role: schema.membershipRole.roleKey,
                })
                .from(schema.membershipRole)
                .where(
                  inArray(
                    schema.membershipRole.membershipId,
                    rows.map((row) => row.membershipId),
                  ),
                )
                .orderBy(asc(schema.membershipRole.roleKey));
        return { total: totalRow?.total ?? 0, rows, roleRows };
      },
    );

    const rolesByMembership = new Map<string, string[]>();
    for (const { membershipId, role } of roleRows) {
      rolesByMembership.set(membershipId, [...(rolesByMembership.get(membershipId) ?? []), role]);
    }
    return {
      members: rows.map(({ membershipId, ...member }) => ({
        ...member,
        roles: rolesByMembership.get(membershipId) ?? [],
      })),
      page: { limit, offset, total },
    };
  }
}
