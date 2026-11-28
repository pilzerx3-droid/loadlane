import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { RequirePermissions } from "../../platform/access.ts";
import { idParamSchema } from "../../platform/directory-http.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { ZodPipe } from "../../platform/validation.ts";
import { API_WEBHOOK_SERVICE } from "./tokens.ts";
import {
  WEBHOOK_EVENTS,
  type DeliverySummary,
  type WebhookService,
  type WebhookSummary,
} from "./webhook-service.ts";

const summarySchema = z.object({
  id: z.uuid(),
  url: z.string(),
  events: z.array(z.string()),
  state: z.enum(["active", "disabled"]),
  createdAt: z.iso.datetime(),
  disabledAt: z.iso.datetime().nullable(),
  createdBy: z.object({ id: z.uuid(), displayName: z.string() }),
  pending: z.number().int(),
  failed: z.number().int(),
});
const createdSchema = summarySchema.extend({
  secret: z.string().describe("The signing secret. Shown in this response only."),
});
const createSchema = z.strictObject({
  url: z.string().max(500),
  events: z
    .array(z.enum(WEBHOOK_EVENTS))
    .min(1)
    .default([...WEBHOOK_EVENTS]),
});
const deliverySchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  eventType: z.string(),
  status: z.enum(["pending", "delivered", "failed"]),
  attempts: z.number().int(),
  lastStatusCode: z.number().int().nullable(),
  lastErrorCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
  deliveredAt: z.iso.datetime().nullable(),
});

function contextOf(request: TenantRequest & { id?: unknown }) {
  const { auth, tenant } = requireTenant(request);
  return {
    organizationId: tenant.organizationId,
    userId: auth.user.id,
    requestId: typeof request.id === "string" ? request.id : undefined,
  };
}

/** Staff side: where Loadlane tells other systems about events (ADR 0022). */
@Controller("v1/webhooks")
export class WebhookController {
  constructor(@Inject(API_WEBHOOK_SERVICE) private readonly service: WebhookService) {}

  @Get()
  @RequirePermissions("integration:manage")
  @ApiRoute({
    summary: "Webhook endpoints of the organization, newest first",
    response: z.object({ items: z.array(summarySchema) }),
  })
  async list(@Req() request: TenantRequest): Promise<{ items: WebhookSummary[] }> {
    return { items: await this.service.list(contextOf(request)) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions("integration:manage")
  @ApiRoute({
    summary:
      "Register an https address that receives signed event calls. The signing secret is in this response only.",
    body: createSchema,
    response: createdSchema,
    status: 201,
  })
  create(
    @Req() request: TenantRequest,
    @Body(new ZodPipe(createSchema)) body: z.output<typeof createSchema>,
  ): Promise<WebhookSummary & { secret: string }> {
    return this.service.create(contextOf(request), body);
  }

  @Post(":id/disable")
  @HttpCode(200)
  @RequirePermissions("integration:manage")
  @ApiRoute({
    summary: "Switch a webhook endpoint off. No further calls are made to it.",
    response: summarySchema,
  })
  disable(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<WebhookSummary> {
    return this.service.disable(contextOf(request), id);
  }

  @Get(":id/deliveries")
  @RequirePermissions("integration:manage")
  @ApiRoute({
    summary: "The latest 50 deliveries to one endpoint with their outcome (no bodies)",
    response: z.object({ items: z.array(deliverySchema) }),
  })
  async deliveries(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<{ items: DeliverySummary[] }> {
    return { items: await this.service.deliveries(contextOf(request), id) };
  }
}
