import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { z } from "zod";
import { RequirePermissions } from "../../platform/access.ts";
import { idParamSchema } from "../../platform/directory-http.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { ZodPipe } from "../../platform/validation.ts";
import {
  calculationDetailSchema,
  calculationListQuerySchema,
  calculationListSchema,
  createCalculationSchema,
  type CalculationDetail,
  type CalculationList,
} from "./calculation.schemas.ts";
import type { CalculationService } from "./calculation-service.ts";
import { CALCULATION_SERVICE } from "./tokens.ts";

function contextOf(request: TenantRequest & { id?: unknown }) {
  const { auth, tenant } = requireTenant(request);
  return {
    organizationId: tenant.organizationId,
    userId: auth.user.id,
    requestId: typeof request.id === "string" ? request.id : undefined,
  };
}

@Controller("v1/calculations")
export class CalculationController {
  constructor(@Inject(CALCULATION_SERVICE) private readonly service: CalculationService) {}

  @Get()
  @RequirePermissions("calculation:read")
  @ApiRoute({
    summary: "Saved calculations, newest first",
    response: calculationListSchema,
    query: calculationListQuerySchema,
  })
  list(
    @Req() request: TenantRequest,
    @Query(new ZodPipe(calculationListQuerySchema))
    query: z.output<typeof calculationListQuerySchema>,
  ): Promise<CalculationList> {
    return this.service.list(contextOf(request), query.limit, query.offset);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions("calculation:manage")
  @ApiRoute({
    summary:
      "Calculate and save. Cost lines are summed and the price is set by markup, margin, contribution or a fixed price. The result is stored as a frozen snapshot; amounts are cents, rates are basis points.",
    body: createCalculationSchema,
    response: calculationDetailSchema,
    status: 201,
  })
  create(
    @Req() request: TenantRequest,
    @Body(new ZodPipe(createCalculationSchema)) body: z.output<typeof createCalculationSchema>,
  ): Promise<CalculationDetail> {
    return this.service.create(contextOf(request), body);
  }

  @Get(":id")
  @RequirePermissions("calculation:read")
  @ApiRoute({
    summary: "One saved calculation with its cost lines and how each amount came about",
    response: calculationDetailSchema,
  })
  get(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<CalculationDetail> {
    return this.service.get(contextOf(request), id);
  }
}
