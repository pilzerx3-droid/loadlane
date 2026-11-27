import { Controller, Get, Inject, Req, UnauthorizedException } from "@nestjs/common";
import { schema, withTenant } from "@loadlane/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import type pg from "pg";
import { z } from "zod";
import { AuthenticatedOnly } from "../../platform/access.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import type { AuthenticatedRequest } from "../../platform/request-context.ts";
import { APP_POOL } from "../../platform/tokens.ts";

export const meResponseSchema = z.object({
  user: z.object({ id: z.uuid(), email: z.string(), displayName: z.string() }),
  organizations: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        slug: z.string(),
        region: z.enum(["us", "eu"]),
      }),
    )
    .describe("Organizations the person is an active member of, for the organization switcher"),
});

export type MeResponse = z.infer<typeof meResponseSchema>;

@Controller("v1")
export class MeController {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  @Get("me")
  @AuthenticatedOnly()
  @ApiRoute({
    summary: "The signed-in person and the organizations they belong to",
    response: meResponseSchema,
  })
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
