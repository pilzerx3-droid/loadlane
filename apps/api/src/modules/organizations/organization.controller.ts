import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { schema, withTenant } from "@loadlane/db";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { AuthenticatedOnly, RequirePermissions } from "../../platform/access.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import {
  requireTenant,
  type AuthenticatedRequest,
  type TenantRequest,
} from "../../platform/request-context.ts";
import { APP_POOL } from "../../platform/tokens.ts";
import { ZodPipe } from "../../platform/validation.ts";
import {
  OrganizationLimitReachedError,
  SlugTakenError,
  type OrganizationCreator,
} from "./organization-creator.ts";
import {
  createOrganizationSchema,
  organizationResponseSchema,
  type CreateOrganizationInput,
  type OrganizationResponse,
} from "./organization.schemas.ts";
import { ORGANIZATION_CREATOR } from "./tokens.ts";

@Controller("v1")
export class OrganizationController {
  constructor(
    @Inject(APP_POOL) private readonly pool: pg.Pool,
    @Inject(ORGANIZATION_CREATOR) private readonly creator: OrganizationCreator,
  ) {}

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

  @Post("organizations")
  @HttpCode(201)
  @AuthenticatedOnly()
  @ApiRoute({
    summary: "Create an organization. The caller becomes its first admin.",
    body: createOrganizationSchema,
    response: organizationResponseSchema,
    status: 201,
  })
  async create(
    @Req() request: AuthenticatedRequest & { id?: unknown },
    @Body(new ZodPipe(createOrganizationSchema)) body: CreateOrganizationInput,
  ): Promise<OrganizationResponse> {
    const auth = request.auth;
    if (!auth) throw new UnauthorizedException();
    try {
      return await this.creator.create(
        auth.user.id,
        body,
        typeof request.id === "string" ? request.id : undefined,
      );
    } catch (error) {
      if (error instanceof OrganizationLimitReachedError) {
        throw new ConflictException({
          statusCode: 409,
          code: "organization_limit_reached",
          message: error.message,
        });
      }
      if (error instanceof SlugTakenError) {
        throw new ConflictException({
          statusCode: 409,
          code: "slug_taken",
          message: error.message,
        });
      }
      throw error;
    }
  }
}
