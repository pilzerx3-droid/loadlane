import { Controller, Get, Inject, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { schema, withTenant } from "@loadlane/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import type pg from "pg";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.ts";
import { APP_POOL } from "../auth/tokens.ts";

export interface MeResponse {
  user: { id: string; email: string; displayName: string };
  /** Organizations the person is an active member of, for the organization switcher. */
  organizations: { id: string; name: string; slug: string; region: "us" | "eu" }[];
}

@Controller("v1")
export class MeController {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  @Get("me")
  @UseGuards(AuthGuard)
  async me(@Req() request: AuthenticatedRequest): Promise<MeResponse> {
    const auth = request.auth;
    if (!auth) throw new UnauthorizedException();

    const organizations = await withTenant(this.pool, { userId: auth.user.id }, ({ db }) =>
      db
        .select({
          id: schema.organization.id,
          name: schema.organization.name,
          slug: schema.organization.slug,
          region: schema.organization.region,
        })
        .from(schema.membership)
        .innerJoin(
          schema.organization,
          eq(schema.membership.organizationId, schema.organization.id),
        )
        .where(
          and(
            eq(schema.membership.userId, auth.user.id),
            eq(schema.membership.status, "active"),
            isNull(schema.organization.deletedAt),
          ),
        )
        .orderBy(asc(schema.organization.name)),
    );

    return { user: auth.user, organizations };
  }
}
