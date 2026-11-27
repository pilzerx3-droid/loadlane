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
import { RequirePermissions } from "../../platform/access.ts";
import { idParamSchema } from "../../platform/directory-http.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { ZodPipe } from "../../platform/validation.ts";
import {
  changeStatusSchema,
  createTransportSchema,
  importReportSchema,
  importTransportsSchema,
  transportDetailSchema,
  transportListQuerySchema,
  transportListResponseSchema,
  updateTransportSchema,
  type TransportDetail,
  type TransportListResponse,
} from "./transport.schemas.ts";
import type { TransportImporter, ImportReport } from "./transport-import.ts";
import type { TransportService } from "./transport-service.ts";
import { TRANSPORT_IMPORTER, TRANSPORT_SERVICE } from "./tokens.ts";

function contextOf(request: TenantRequest & { id?: unknown }) {
  const { auth, tenant } = requireTenant(request);
  return {
    organizationId: tenant.organizationId,
    userId: auth.user.id,
    requestId: typeof request.id === "string" ? request.id : undefined,
  };
}

@Controller("v1/transports")
export class TransportController {
  constructor(
    @Inject(TRANSPORT_SERVICE) private readonly service: TransportService,
    @Inject(TRANSPORT_IMPORTER) private readonly importer: TransportImporter,
  ) {}

  @Get()
  @RequirePermissions("transport:read")
  @ApiRoute({
    summary: "Transports of the organization, newest number first",
    response: transportListResponseSchema,
    query: transportListQuerySchema,
  })
  list(
    @Req() request: TenantRequest,
    @Query(new ZodPipe(transportListQuerySchema)) query: z.output<typeof transportListQuerySchema>,
  ): Promise<TransportListResponse> {
    return this.service.list(contextOf(request), query);
  }

  @Post("import")
  @HttpCode(200)
  @RequirePermissions("transport:manage")
  @ApiRoute({
    summary:
      "Check a CSV file of transports, or import it. All rows are imported or none. Customers, carriers and locations are matched by name.",
    body: importTransportsSchema,
    response: importReportSchema,
  })
  importCsv(
    @Req() request: TenantRequest,
    @Body(new ZodPipe(importTransportsSchema)) body: z.output<typeof importTransportsSchema>,
  ): Promise<ImportReport> {
    return this.importer.run(contextOf(request), body.csv, body.dryRun);
  }

  @Get(":id")
  @RequirePermissions("transport:read")
  @ApiRoute({
    summary: "One transport with its stops and status history",
    response: transportDetailSchema,
  })
  get(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<TransportDetail> {
    return this.service.get(contextOf(request), id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions("transport:manage")
  @ApiRoute({
    summary: "Create a transport with its stops. It starts in status created.",
    body: createTransportSchema,
    response: transportDetailSchema,
    status: 201,
  })
  create(
    @Req() request: TenantRequest,
    @Body(new ZodPipe(createTransportSchema)) body: z.output<typeof createTransportSchema>,
  ): Promise<TransportDetail> {
    return this.service.create(contextOf(request), body);
  }

  @Patch(":id")
  @RequirePermissions("transport:manage")
  @ApiRoute({
    summary:
      "Change fields, the carrier or the stops of a transport that is not on the road yet. Fields left out stay as they are.",
    body: updateTransportSchema,
    response: transportDetailSchema,
  })
  update(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(updateTransportSchema)) body: z.output<typeof updateTransportSchema>,
  ): Promise<TransportDetail> {
    return this.service.update(contextOf(request), id, body);
  }

  @Post(":id/status")
  @HttpCode(200)
  @RequirePermissions("transport:manage")
  @ApiRoute({
    summary: "Move a transport to its next status. Writes an entry in the history.",
    body: changeStatusSchema,
    response: transportDetailSchema,
  })
  changeStatus(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(changeStatusSchema)) body: z.output<typeof changeStatusSchema>,
  ): Promise<TransportDetail> {
    return this.service.changeStatus(contextOf(request), id, body.status, body.note);
  }
}
