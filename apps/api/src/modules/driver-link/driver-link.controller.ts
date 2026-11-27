import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { RequirePermissions } from "../../platform/access.ts";
import { idParamSchema } from "../../platform/directory-http.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { ZodPipe } from "../../platform/validation.ts";
import {
  MAX_LINK_HOURS,
  type CreatedDriverLink,
  type DriverLinkService,
  type DriverLinkSummary,
} from "./driver-link-service.ts";
import { DRIVER_LINK_SERVICE } from "./tokens.ts";

const summarySchema = z.object({
  id: z.uuid(),
  transportId: z.uuid(),
  state: z.enum(["active", "expired", "revoked"]),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  createdBy: z.object({ id: z.uuid(), displayName: z.string() }),
  consent: z
    .object({ acceptedAt: z.iso.datetime(), withdrawnAt: z.iso.datetime().nullable() })
    .nullable(),
});
const createdSchema = summarySchema.extend({ token: z.string() });
const listSchema = z.object({ items: z.array(summarySchema) });
const createBodySchema = z.object({
  expiresInHours: z.number().int().min(1).max(MAX_LINK_HOURS).optional(),
});

function contextOf(request: TenantRequest & { id?: unknown }) {
  const { auth, tenant } = requireTenant(request);
  return {
    organizationId: tenant.organizationId,
    userId: auth.user.id,
    requestId: typeof request.id === "string" ? request.id : undefined,
  };
}

@Controller("v1")
export class DriverLinkController {
  constructor(@Inject(DRIVER_LINK_SERVICE) private readonly service: DriverLinkService) {}

  @Get("transports/:id/driver-links")
  @RequirePermissions("transport:read")
  @ApiRoute({ summary: "Driver Links of a transport, newest first", response: listSchema })
  async list(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<{ items: DriverLinkSummary[] }> {
    return { items: await this.service.list(contextOf(request), id) };
  }

  @Post("transports/:id/driver-links")
  @HttpCode(201)
  @RequirePermissions("transport:manage")
  @ApiRoute({
    summary:
      "Create a Driver Link. The secret token is in this response only and cannot be read again.",
    response: createdSchema,
    status: 201,
  })
  create(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(createBodySchema)) body: z.infer<typeof createBodySchema>,
  ): Promise<CreatedDriverLink> {
    return this.service.create(contextOf(request), id, body.expiresInHours);
  }

  @Post("driver-links/:id/revoke")
  @HttpCode(200)
  @RequirePermissions("transport:manage")
  @ApiRoute({
    summary: "Revoke a Driver Link so it stops working at once",
    response: summarySchema,
  })
  revoke(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<DriverLinkSummary> {
    return this.service.revoke(contextOf(request), id);
  }
}
