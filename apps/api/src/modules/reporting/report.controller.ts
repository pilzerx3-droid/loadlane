import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import type { z } from "zod";
import { RequirePermissions } from "../../platform/access.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { ZodPipe } from "../../platform/validation.ts";
import {
  commercialReportSchema,
  reportQuerySchema,
  type CommercialReport,
} from "./report.schemas.ts";
import type { ReportService } from "./report-service.ts";
import { REPORT_SERVICE } from "./tokens.ts";

@Controller("v1/reports")
export class ReportController {
  constructor(@Inject(REPORT_SERVICE) private readonly service: ReportService) {}

  @Get("commercial")
  @RequirePermissions("report:read")
  @ApiRoute({
    summary:
      "Spot freight, quote and delivery figures for a period, from stored data only. Nothing is estimated.",
    response: commercialReportSchema,
    query: reportQuerySchema,
  })
  commercial(
    @Req() request: TenantRequest,
    @Query(new ZodPipe(reportQuerySchema)) query: z.output<typeof reportQuerySchema>,
  ): Promise<CommercialReport> {
    const { auth, tenant } = requireTenant(request);
    return this.service.commercial(
      { organizationId: tenant.organizationId, userId: auth.user.id },
      query,
    );
  }
}
