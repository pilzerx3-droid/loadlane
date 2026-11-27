import { Controller, Get, Inject, NotFoundException, Req } from "@nestjs/common";
import { schema, withTenant } from "@loadlane/db";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { z } from "zod";
import { RequirePermissions } from "../../platform/access.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { APP_POOL } from "../../platform/tokens.ts";

export const organizationResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  region: z.enum(["us", "eu"]),
  distanceUnit: z.enum(["mi", "km"]),
  weightUnit: z.enum(["lb", "kg"]),
  currency: z.string().describe("ISO 4217 code"),
  locale: z.string(),
  timezone: z.string().describe("IANA time zone name"),
});

export type OrganizationResponse = z.infer<typeof organizationResponseSchema>;

@Controller("v1")
export class OrganizationController {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  @Get("organization")
  @RequirePermissions("organization:read")
  @ApiRoute({
    summary: "The organization named in X-Organization-Id, with its unit and locale defaults",
    response: organizationResponseSchema,
  })
  async get(@Req() request: TenantRequest): Promise<OrganizationResponse> {
    const { auth, tenant } = requireTenant(request);
    const rows = await withTenant(
      this.pool,
      { userId: auth.user.id, organizationId: tenant.organizationId },
      ({ db }) =>
        db
          .select({
            id: schema.organization.id,
            name: schema.organization.name,
            slug: schema.organization.slug,
            region: schema.organization.region,
            distanceUnit: schema.organization.distanceUnit,
            weightUnit: schema.organization.weightUnit,
            currency: schema.organization.currency,
            locale: schema.organization.locale,
            timezone: schema.organization.timezone,
          })
          .from(schema.organization)
          .where(eq(schema.organization.id, tenant.organizationId))
          .limit(1),
    );
    const organization = rows[0];
    if (!organization) throw new NotFoundException();
    return organization;
  }
}
