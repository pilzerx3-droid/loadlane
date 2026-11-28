import { Controller, Get, Inject, Param, Req } from "@nestjs/common";
import { z } from "zod";
import { RequirePermissions } from "../../platform/access.ts";
import { idParamSchema } from "../../platform/directory-http.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { ZodPipe } from "../../platform/validation.ts";
import type { EtaService, EtaView } from "./eta-service.ts";
import { ETA_SERVICE } from "./tokens.ts";

const etaSchema = z.object({
  estimate: z
    .object({
      estimatedArrival: z.iso.datetime(),
      computedAt: z.iso.datetime(),
      basedOnPositionAt: z.iso.datetime(),
      distanceMiles: z.number(),
      drivingMinutes: z.number().int(),
      provider: z.string(),
      excludesTrafficAndBreaks: z.literal(true),
    })
    .nullable()
    .describe("null when there is no current estimate"),
  routingConfigured: z.boolean(),
});

@Controller("v1/transports")
export class EtaController {
  constructor(@Inject(ETA_SERVICE) private readonly service: EtaService) {}

  @Get(":id/eta")
  @RequirePermissions("transport:read")
  @ApiRoute({
    summary:
      "The estimated arrival at the final stop, from the last reported position and a routing provider. Driving time only: no traffic, breaks or waiting. null when none is current.",
    response: etaSchema,
  })
  get(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<EtaView> {
    const { auth, tenant } = requireTenant(request);
    return this.service.get({ organizationId: tenant.organizationId, userId: auth.user.id }, id);
  }
}
