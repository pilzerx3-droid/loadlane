import { Controller, Get, Inject, Req } from "@nestjs/common";
import { z } from "zod";
import { RequirePermissions } from "../../platform/access.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import type { MailLogEntry, MailService } from "./mail-service.ts";
import { MAIL_SERVICE } from "./tokens.ts";

const entrySchema = z.object({
  id: z.uuid(),
  kind: z.enum(["tracking_link", "spot_invitation", "quote"]),
  relatedId: z.uuid().nullable(),
  recipient: z.string(),
  status: z.enum(["sent", "failed"]),
  errorCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
  sentBy: z.object({ id: z.uuid(), displayName: z.string() }),
});
const listSchema = z.object({ items: z.array(entrySchema) });

@Controller("v1/mail-log")
export class NotificationsController {
  constructor(@Inject(MAIL_SERVICE) private readonly mail: MailService) {}

  @Get()
  @RequirePermissions("audit:read")
  @ApiRoute({
    summary:
      "The e-mails this organization sent through Loadlane, newest first (no bodies, no links)",
    response: listSchema,
  })
  async list(@Req() request: TenantRequest): Promise<{ items: MailLogEntry[] }> {
    const { auth, tenant } = requireTenant(request);
    return {
      items: await this.mail.list({ organizationId: tenant.organizationId, userId: auth.user.id }),
    };
  }
}
