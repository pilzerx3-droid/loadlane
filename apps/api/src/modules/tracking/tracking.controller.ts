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
import {
  MAIL_SERVICE,
  trackingLinkMail,
  usDate,
  type MailOutcome,
  type MailService,
} from "../notifications/index.ts";

const summarySchema = z.object({
  id: z.uuid(),
  transportId: z.uuid(),
  state: z.enum(["active", "expired", "revoked"]),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  createdBy: z.object({ id: z.uuid(), displayName: z.string() }),
});
const mailOutcomeSchema = z.object({
  status: z.enum(["sent", "failed"]),
  errorCode: z.string().nullable(),
});
const createdSchema = summarySchema.extend({
  token: z.string(),
  reference: z.string(),
  /** Present only when `emailTo` was given: whether the mail went out. */
  mail: mailOutcomeSchema.optional(),
});
const listSchema = z.object({ items: z.array(summarySchema) });
const createBodySchema = z.object({
  expiresInDays: z.number().int().min(1).max(MAX_TRACKING_DAYS).optional(),
  /** Send the link to this address. The link is created either way; the response says whether the mail went out. */
  emailTo: z.email().max(254).optional(),
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
  constructor(
    @Inject(TRACKING_SERVICE) private readonly service: TrackingService,
    @Inject(MAIL_SERVICE) private readonly mail: MailService,
  ) {}

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
  async create(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(createBodySchema)) body: z.infer<typeof createBodySchema>,
  ): Promise<CreatedTrackingLink & { mail?: MailOutcome }> {
    const context = contextOf(request);
    if (body.emailTo) this.mail.assertConfigured(); // fail before a link exists that nobody can receive
    const link = await this.service.create(context, id, body.expiresInDays);
    if (!body.emailTo) return link;
    const content = trackingLinkMail({
      senderName: await this.mail.senderName(context),
      reference: link.reference,
      link: `${this.mail.appUrl}/t/${link.token}`,
      expiresOn: usDate(link.expiresAt),
    });
    const mail = await this.mail.send(context, {
      kind: "tracking_link",
      relatedId: link.transportId,
      message: { to: body.emailTo, ...content },
    });
    return { ...link, mail };
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
