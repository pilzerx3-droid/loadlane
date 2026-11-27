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
  createCustomerSchema,
  customerSchema,
  updateCustomerSchema,
  type CustomerResponse,
} from "./customer.schemas.ts";
import { CUSTOMER_REPOSITORY } from "./tokens.ts";

const listResponseSchema = directoryListResponseSchema(customerSchema);

function contextOf(request: TenantRequest & { id?: unknown }) {
  const { auth, tenant } = requireTenant(request);
  return {
    organizationId: tenant.organizationId,
    userId: auth.user.id,
    requestId: typeof request.id === "string" ? request.id : undefined,
  };
}

@Controller("v1/customers")
export class CustomerController {
  constructor(@Inject(CUSTOMER_REPOSITORY) private readonly repository: DirectoryRepository) {}

  @Get()
  @RequirePermissions("customer:read")
  @ApiRoute({
    summary: "Customers of the organization, sorted by name",
    response: listResponseSchema,
    query: directoryListQuerySchema,
  })
  async list(
    @Req() request: TenantRequest,
    @Query(new ZodPipe(directoryListQuerySchema)) query: z.output<typeof directoryListQuerySchema>,
  ): Promise<z.infer<typeof listResponseSchema>> {
    const { rows, total } = await this.repository.list(contextOf(request), query);
    return {
      items: rows as unknown as CustomerResponse[],
      page: { limit: query.limit, offset: query.offset, total },
    };
  }

  @Get(":id")
  @RequirePermissions("customer:read")
  @ApiRoute({ summary: "One customer", response: customerSchema })
  async get(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<CustomerResponse> {
    return (await this.repository.get(contextOf(request), id)) as unknown as CustomerResponse;
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions("customer:manage")
  @ApiRoute({
    summary: "Create a customer",
    body: createCustomerSchema,
    response: customerSchema,
    status: 201,
  })
  async create(
    @Req() request: TenantRequest,
    @Body(new ZodPipe(createCustomerSchema)) body: z.output<typeof createCustomerSchema>,
  ): Promise<CustomerResponse> {
    return (await this.repository.create(contextOf(request), body)) as unknown as CustomerResponse;
  }

  @Patch(":id")
  @RequirePermissions("customer:manage")
  @ApiRoute({
    summary: "Change a customer, or archive or restore it. Fields left out stay as they are.",
    body: updateCustomerSchema,
    response: customerSchema,
  })
  async update(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(updateCustomerSchema)) body: z.output<typeof updateCustomerSchema>,
  ): Promise<CustomerResponse> {
    return (await this.repository.update(
      contextOf(request),
      id,
      body,
    )) as unknown as CustomerResponse;
  }
}
