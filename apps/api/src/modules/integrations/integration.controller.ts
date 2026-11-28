import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiHeader } from "@nestjs/swagger";
import { z } from "zod";
import { Public, RequirePermissions } from "../../platform/access.ts";
import { idParamSchema } from "../../platform/directory-http.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { ZodPipe } from "../../platform/validation.ts";
import type { ApiKeyService } from "./api-key-service.ts";
import {
  createKeySchema,
  createdKeySchema,
  inboundResultSchema,
  inboundTransportSchema,
  keyListSchema,
  keySummarySchema,
  lookupKindSchema,
  lookupQuerySchema,
  lookupResultSchema,
  type CreatedKey,
  type InboundResult,
  type KeySummary,
  type LookupResult,
} from "./integration.schemas.ts";
import type { IntegrationService } from "./integration-service.ts";
import { API_KEY_SERVICE, INTEGRATION_SERVICE } from "./tokens.ts";

function contextOf(request: TenantRequest & { id?: unknown }) {
  const { auth, tenant } = requireTenant(request);
  return {
    organizationId: tenant.organizationId,
    userId: auth.user.id,
    requestId: typeof request.id === "string" ? request.id : undefined,
  };
}

/** Staff side: manage the API keys of the organization. */
@Controller("v1/api-keys")
export class ApiKeyController {
  constructor(@Inject(API_KEY_SERVICE) private readonly service: ApiKeyService) {}

  @Get()
  @RequirePermissions("integration:manage")
  @ApiRoute({ summary: "API keys of the organization, newest first", response: keyListSchema })
  async list(@Req() request: TenantRequest): Promise<{ items: KeySummary[] }> {
    return { items: await this.service.list(contextOf(request)) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions("integration:manage")
  @ApiRoute({
    summary:
      "Create an API key for another system. The key is in this response only; only a hash is stored.",
    body: createKeySchema,
    response: createdKeySchema,
    status: 201,
  })
  create(
    @Req() request: TenantRequest,
    @Body(new ZodPipe(createKeySchema)) body: z.output<typeof createKeySchema>,
  ): Promise<CreatedKey> {
    return this.service.create(contextOf(request), body);
  }

  @Post(":id/revoke")
  @HttpCode(200)
  @RequirePermissions("integration:manage")
  @ApiRoute({ summary: "Revoke an API key. It stops working at once.", response: keySummarySchema })
  revoke(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<KeySummary> {
    return this.service.revoke(contextOf(request), id);
  }
}

const keyHeader = ApiHeader({
  name: "X-Api-Key",
  required: true,
  description:
    "An API key created by an administrator. It is the only credential; never put it in a URL.",
});

/** The API for other systems. Public in the sense of ADR 0010: the API key is checked on every call. */
@Controller("v1/integration")
export class IntegrationController {
  constructor(@Inject(INTEGRATION_SERVICE) private readonly service: IntegrationService) {}

  @Get("lookups/:kind")
  @Public()
  @keyHeader
  @ApiRoute({
    summary:
      "Ids and names of customers, carriers or locations, to use when creating transports (scope lookup:read)",
    response: lookupResultSchema,
    query: lookupQuerySchema,
  })
  async lookups(
    @Headers("x-api-key") key: unknown,
    @Param("kind", new ZodPipe(lookupKindSchema)) kind: z.output<typeof lookupKindSchema>,
    @Query(new ZodPipe(lookupQuerySchema)) query: z.output<typeof lookupQuerySchema>,
  ): Promise<LookupResult> {
    const grant = await this.service.authenticate(key, "lookup:read");
    return this.service.lookup(grant, kind, query);
  }

  @Post("transports")
  @HttpCode(200)
  @Public()
  @keyHeader
  @ApiRoute({
    summary:
      "Create a transport from another system (scope transport:write). Safe to repeat: the same externalId with the same content returns the same transport; different content is a 409.",
    body: inboundTransportSchema,
    response: inboundResultSchema,
  })
  async transports(
    @Headers("x-api-key") key: unknown,
    @Body(new ZodPipe(inboundTransportSchema)) body: z.output<typeof inboundTransportSchema>,
  ): Promise<InboundResult> {
    const grant = await this.service.authenticate(key, "transport:write");
    return this.service.createTransport(grant, body);
  }
}
