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
  createLocationSchema,
  locationSchema,
  updateLocationSchema,
  type LocationResponse,
} from "./location.schemas.ts";
import { LOCATION_REPOSITORY } from "./tokens.ts";

const listResponseSchema = directoryListResponseSchema(locationSchema);

function contextOf(request: TenantRequest & { id?: unknown }) {
  const { auth, tenant } = requireTenant(request);
  return {
    organizationId: tenant.organizationId,
    userId: auth.user.id,
    requestId: typeof request.id === "string" ? request.id : undefined,
  };
}

@Controller("v1/locations")
export class LocationController {
  constructor(@Inject(LOCATION_REPOSITORY) private readonly repository: DirectoryRepository) {}

  @Get()
  @RequirePermissions("location:read")
  @ApiRoute({
    summary: "Locations of the organization, sorted by name",
    response: listResponseSchema,
    query: directoryListQuerySchema,
  })
  async list(
    @Req() request: TenantRequest,
    @Query(new ZodPipe(directoryListQuerySchema)) query: z.output<typeof directoryListQuerySchema>,
  ): Promise<z.infer<typeof listResponseSchema>> {
    const { rows, total } = await this.repository.list(contextOf(request), query);
    return {
      items: rows as unknown as LocationResponse[],
      page: { limit: query.limit, offset: query.offset, total },
    };
  }

  @Get(":id")
  @RequirePermissions("location:read")
  @ApiRoute({ summary: "One location", response: locationSchema })
  async get(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<LocationResponse> {
    return (await this.repository.get(contextOf(request), id)) as unknown as LocationResponse;
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions("location:manage")
  @ApiRoute({
    summary: "Create a location",
    body: createLocationSchema,
    response: locationSchema,
    status: 201,
  })
  async create(
    @Req() request: TenantRequest,
    @Body(new ZodPipe(createLocationSchema)) body: z.output<typeof createLocationSchema>,
  ): Promise<LocationResponse> {
    return (await this.repository.create(contextOf(request), body)) as unknown as LocationResponse;
  }

  @Patch(":id")
  @RequirePermissions("location:manage")
  @ApiRoute({
    summary: "Change a location, or archive or restore it. Fields left out stay as they are.",
    body: updateLocationSchema,
    response: locationSchema,
  })
  async update(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(updateLocationSchema)) body: z.output<typeof updateLocationSchema>,
  ): Promise<LocationResponse> {
    return (await this.repository.update(
      contextOf(request),
      id,
      body,
    )) as unknown as LocationResponse;
  }
}
