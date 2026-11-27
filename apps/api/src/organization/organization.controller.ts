import { Controller, Get, Inject, NotFoundException, Req } from "@nestjs/common";
import { schema, withTenant } from "@loadlane/db";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { RequirePermissions, requireTenant, type TenantRequest } from "../access/access.ts";
import { APP_POOL } from "../auth/tokens.ts";

export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  region: "us" | "eu";
  distanceUnit: "mi" | "km";
  weightUnit: "lb" | "kg";
  currency: string;
  locale: string;
  timezone: string;
}

@Controller("v1")
export class OrganizationController {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  /** The organization named in X-Organization-Id, with its unit and locale defaults. */
  @Get("organization")
  @RequirePermissions("organization:read")
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
