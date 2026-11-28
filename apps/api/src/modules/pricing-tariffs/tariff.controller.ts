import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { z } from "zod";
import { RequirePermissions } from "../../platform/access.ts";
import { idParamSchema } from "../../platform/directory-http.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { ZodPipe } from "../../platform/validation.ts";
import {
  applyResultSchema,
  applySchema,
  createTariffSchema,
  newVersionSchema,
  tariffDetailSchema,
  tariffListQuerySchema,
  tariffListSchema,
  type ApplyResultOut,
  type TariffDetail,
  type TariffList,
} from "./tariff.schemas.ts";
import type { TariffService } from "./tariff-service.ts";
import { TARIFF_SERVICE } from "./tokens.ts";

function contextOf(request: TenantRequest & { id?: unknown }) {
  const { auth, tenant } = requireTenant(request);
  return {
    organizationId: tenant.organizationId,
    userId: auth.user.id,
    requestId: typeof request.id === "string" ? request.id : undefined,
  };
}

@Controller("v1/tariffs")
export class TariffController {
  constructor(@Inject(TARIFF_SERVICE) private readonly service: TariffService) {}

  @Get()
  @RequirePermissions("tariff:read")
  @ApiRoute({
    summary: "Price lists by name",
    response: tariffListSchema,
    query: tariffListQuerySchema,
  })
  list(
    @Req() request: TenantRequest,
    @Query(new ZodPipe(tariffListQuerySchema)) query: z.output<typeof tariffListQuerySchema>,
  ): Promise<TariffList> {
    return this.service.list(contextOf(request), query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions("tariff:manage")
  @ApiRoute({
    summary: "Create a price list with its first version",
    body: createTariffSchema,
    response: tariffDetailSchema,
    status: 201,
  })
  create(
    @Req() request: TenantRequest,
    @Body(new ZodPipe(createTariffSchema)) body: z.output<typeof createTariffSchema>,
  ): Promise<TariffDetail> {
    return this.service.create(contextOf(request), body);
  }

  @Get(":id")
  @RequirePermissions("tariff:read")
  @ApiRoute({ summary: "One price list with all its versions", response: tariffDetailSchema })
  get(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<TariffDetail> {
    return this.service.get(contextOf(request), id);
  }

  @Post(":id/versions")
  @HttpCode(201)
  @RequirePermissions("tariff:manage")
  @ApiRoute({
    summary: "Add a new version with new rates from a start date. Existing versions never change.",
    body: newVersionSchema,
    response: tariffDetailSchema,
    status: 201,
  })
  addVersion(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(newVersionSchema)) body: z.output<typeof newVersionSchema>,
  ): Promise<TariffDetail> {
    return this.service.addVersion(contextOf(request), id, body);
  }

  @Post(":id/archive")
  @HttpCode(200)
  @RequirePermissions("tariff:manage")
  @ApiRoute({ summary: "Archive a price list", response: tariffDetailSchema })
  archive(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<TariffDetail> {
    return this.service.setArchived(contextOf(request), id, true);
  }

  @Post(":id/restore")
  @HttpCode(200)
  @RequirePermissions("tariff:manage")
  @ApiRoute({ summary: "Restore an archived price list", response: tariffDetailSchema })
  restore(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<TariffDetail> {
    return this.service.setArchived(contextOf(request), id, false);
  }

  @Post(":id/apply")
  @HttpCode(200)
  @RequirePermissions("tariff:read")
  @ApiRoute({
    summary:
      "Price a shipment with the version in force on a date. Returns cost lines and the exact version used; nothing is saved.",
    body: applySchema,
    response: applyResultSchema,
  })
  apply(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(applySchema)) body: z.output<typeof applySchema>,
  ): Promise<ApplyResultOut> {
    return this.service.apply(contextOf(request), id, body);
  }
}
