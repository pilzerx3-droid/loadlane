import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { z } from "zod";
import { type DirectoryRepository } from "../../platform/directory-repository.ts";
import {
  directoryListQuerySchema,
  directoryListResponseSchema,
  idParamSchema,
} from "../../platform/directory-http.ts";
import { RequirePermissions } from "../../platform/access.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { ZodPipe } from "../../platform/validation.ts";
import {
  createCarrierSchema,
  carrierSchema,
  updateCarrierSchema,
  type CarrierResponse,
} from "./carrier.schemas.ts";
import { CARRIER_REPOSITORY } from "./tokens.ts";

const listResponseSchema = directoryListResponseSchema(carrierSchema);

function contextOf(request: TenantRequest & { id?: unknown }) {
  const { auth, tenant } = requireTenant(request);
  return {
    organizationId: tenant.organizationId,
    userId: auth.user.id,
    requestId: typeof request.id === "string" ? request.id : undefined,
  };
}

@Controller("v1/carriers")
export class CarrierController {
  constructor(@Inject(CARRIER_REPOSITORY) private readonly repository: DirectoryRepository) {}

  @Get()
  @RequirePermissions("carrier:read")
  @ApiRoute({
    summary: "Carriers of the organization, sorted by name",
    response: listResponseSchema,
    query: directoryListQuerySchema,
  })
  async list(
    @Req() request: TenantRequest,
    @Query(new ZodPipe(directoryListQuerySchema)) query: z.output<typeof directoryListQuerySchema>,
  ): Promise<z.infer<typeof listResponseSchema>> {
    const { rows, total } = await this.repository.list(contextOf(request), query);
    return {
      items: rows as unknown as CarrierResponse[],
      page: { limit: query.limit, offset: query.offset, total },
    };
  }

  @Get(":id")
  @RequirePermissions("carrier:read")
  @ApiRoute({ summary: "One carrier", response: carrierSchema })
  async get(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<CarrierResponse> {
    return (await this.repository.get(contextOf(request), id)) as unknown as CarrierResponse;
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions("carrier:manage")
  @ApiRoute({
    summary: "Create a carrier",
    body: createCarrierSchema,
    response: carrierSchema,
    status: 201,
  })
  async create(
    @Req() request: TenantRequest,
    @Body(new ZodPipe(createCarrierSchema)) body: z.output<typeof createCarrierSchema>,
  ): Promise<CarrierResponse> {
    return (await this.repository.create(contextOf(request), body)) as unknown as CarrierResponse;
  }

  @Patch(":id")
  @RequirePermissions("carrier:manage")
  @ApiRoute({
    summary: "Change a carrier, or archive or restore it. Fields left out stay as they are.",
    body: updateCarrierSchema,
    response: carrierSchema,
  })
  async update(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(updateCarrierSchema)) body: z.output<typeof updateCarrierSchema>,
  ): Promise<CarrierResponse> {
    return (await this.repository.update(
      contextOf(request),
      id,
      body,
    )) as unknown as CarrierResponse;
  }
}
