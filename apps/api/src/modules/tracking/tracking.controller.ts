import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import { ApiHeader } from "@nestjs/swagger";
import { z } from "zod";
import { Public, RequirePermissions } from "../../platform/access.ts";
import { idParamSchema } from "../../platform/directory-http.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { ZodPipe } from "../../platform/validation.ts";
import {
  MAX_TRACKING_DAYS,
  type CreatedTrackingLink,
  type PublicTrackingView,
  type TrackingLinkSummary,
  type TrackingService,
} from "./tracking-service.ts";
import { TRACKING_SERVICE } from "./tokens.ts";

const summarySchema = z.object({
  id: z.uuid(),
  transportId: z.uuid(),
  state: z.enum(["active", "expired", "revoked"]),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  createdBy: z.object({ id: z.uuid(), displayName: z.string() }),
});
const createdSchema = summarySchema.extend({ token: z.string() });
const listSchema = z.object({ items: z.array(summarySchema) });
const createBodySchema = z.object({
  expiresInDays: z.number().int().min(1).max(MAX_TRACKING_DAYS).optional(),
});
const viewSchema = z.object({
  reference: z.string(),
  customerReference: z.string().nullable(),
  status: z.string(),
  stops: z.array(
    z.object({
      sequence: z.number().int(),
      type: z.enum(["pickup", "delivery"]),
      placeName: z.string(),
      city: z.string(),
      state: z.string(),
      windowStart: z.iso.datetime(),
      windowEnd: z.iso.datetime(),
      timezone: z.string(),
    }),
  ),
  history: z.array(z.object({ status: z.string(), occurredAt: z.iso.datetime() })),
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
export class TrackingController {
  constructor(@Inject(TRACKING_SERVICE) private readonly service: TrackingService) {}

  @Get("transports/:id/tracking-links")
  @RequirePermissions("transport:read")
  @ApiRoute({
    summary: "Customer tracking links of a transport, newest first",
    response: listSchema,
  })
  async list(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<{ items: TrackingLinkSummary[] }> {
    return { items: await this.service.list(contextOf(request), id) };
  }

  @Post("transports/:id/tracking-links")
  @HttpCode(201)
  @RequirePermissions("transport:manage")
  @ApiRoute({
    summary:
      "Create a customer tracking link. The secret token is in this response only and cannot be read again.",
    response: createdSchema,
    status: 201,
  })
  create(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(createBodySchema)) body: z.infer<typeof createBodySchema>,
  ): Promise<CreatedTrackingLink> {
    return this.service.create(contextOf(request), id, body.expiresInDays);
  }

  @Post("tracking-links/:id/revoke")
  @HttpCode(200)
  @RequirePermissions("transport:manage")
  @ApiRoute({ summary: "Revoke a customer tracking link", response: summarySchema })
  revoke(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<TrackingLinkSummary> {
    return this.service.revoke(contextOf(request), id);
  }

  @Get("tracking/view")
  @Public()
  @ApiHeader({
    name: "X-Tracking-Token",
    required: true,
    description: "The secret token of a tracking link. Never accepted in a URL.",
  })
  @ApiRoute({
    summary:
      "The customer's view of one transport: status, planned windows and status history. Never a driver position.",
    response: viewSchema,
  })
  view(@Headers("x-tracking-token") token: unknown): Promise<PublicTrackingView> {
    return this.service.view(token);
  }
}
