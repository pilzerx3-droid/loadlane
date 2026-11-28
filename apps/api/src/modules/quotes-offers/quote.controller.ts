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
  createQuoteSchema,
  quoteDetailSchema,
  quoteListQuerySchema,
  quoteListSchema,
  quoteStatusBodySchema,
  updateQuoteSchema,
  type QuoteDetail,
  type QuoteList,
} from "./quote.schemas.ts";
import type { QuoteService } from "./quote-service.ts";
import { QUOTE_SERVICE } from "./tokens.ts";

function contextOf(request: TenantRequest & { id?: unknown }) {
  const { auth, tenant } = requireTenant(request);
  return {
    organizationId: tenant.organizationId,
    userId: auth.user.id,
    requestId: typeof request.id === "string" ? request.id : undefined,
  };
}

@Controller("v1/quotes")
export class QuoteController {
  constructor(@Inject(QUOTE_SERVICE) private readonly service: QuoteService) {}

  @Get()
  @RequirePermissions("quote:read")
  @ApiRoute({
    summary: "Quotes, newest number first",
    response: quoteListSchema,
    query: quoteListQuerySchema,
  })
  list(
    @Req() request: TenantRequest,
    @Query(new ZodPipe(quoteListQuerySchema)) query: z.output<typeof quoteListQuerySchema>,
  ): Promise<QuoteList> {
    return this.service.list(contextOf(request), query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions("quote:manage")
  @ApiRoute({
    summary:
      "Create a draft quote that offers the price of a frozen calculation. The price is copied and never changes.",
    body: createQuoteSchema,
    response: quoteDetailSchema,
    status: 201,
  })
  create(
    @Req() request: TenantRequest,
    @Body(new ZodPipe(createQuoteSchema)) body: z.output<typeof createQuoteSchema>,
  ): Promise<QuoteDetail> {
    return this.service.create(contextOf(request), body);
  }

  @Get(":id")
  @RequirePermissions("quote:read")
  @ApiRoute({ summary: "One quote with its calculation figures", response: quoteDetailSchema })
  get(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<QuoteDetail> {
    return this.service.get(contextOf(request), id);
  }

  @Patch(":id")
  @RequirePermissions("quote:manage")
  @ApiRoute({
    summary: "Change the validity, terms or notes of a draft quote",
    body: updateQuoteSchema,
    response: quoteDetailSchema,
  })
  update(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(updateQuoteSchema)) body: z.output<typeof updateQuoteSchema>,
  ): Promise<QuoteDetail> {
    return this.service.update(contextOf(request), id, body);
  }

  @Post(":id/status")
  @HttpCode(200)
  @RequirePermissions("quote:manage")
  @ApiRoute({
    summary:
      "Move a quote to the next status: draft to sent, sent to accepted or rejected, or cancel while draft or sent",
    body: quoteStatusBodySchema,
    response: quoteDetailSchema,
  })
  changeStatus(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(quoteStatusBodySchema)) body: z.output<typeof quoteStatusBodySchema>,
  ): Promise<QuoteDetail> {
    return this.service.changeStatus(contextOf(request), id, body.status);
  }
}
