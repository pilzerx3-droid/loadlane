import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { RequirePermissions } from "../../platform/access.ts";
import { idParamSchema } from "../../platform/directory-http.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { ValidationFailedError, ZodPipe } from "../../platform/validation.ts";
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
import { renderQuotePdf } from "./quote-pdf.ts";
import type { QuoteService } from "./quote-service.ts";
import { QUOTE_SERVICE } from "./tokens.ts";
import { MAIL_SERVICE, quoteMail, usDate, type MailService } from "../notifications/index.ts";

const emailQuoteSchema = z.strictObject({ to: z.email().max(254).optional() });
const emailQuoteResultSchema = z.object({
  to: z.string(),
  status: z.enum(["sent", "failed"]),
  errorCode: z.string().nullable(),
});

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
  constructor(
    @Inject(QUOTE_SERVICE) private readonly service: QuoteService,
    @Inject(MAIL_SERVICE) private readonly mail: MailService,
  ) {}

  @Post(":id/email")
  @HttpCode(200)
  @RequirePermissions("quote:manage")
  @ApiRoute({
    summary:
      "E-mail a sent quote as a PDF. Goes to `to`, or to the customer's contact address when `to` is left out.",
    body: emailQuoteSchema,
    response: emailQuoteResultSchema,
  })
  async email(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Body(new ZodPipe(emailQuoteSchema)) body: z.output<typeof emailQuoteSchema>,
  ): Promise<z.output<typeof emailQuoteResultSchema>> {
    const context = contextOf(request);
    this.mail.assertConfigured();
    const data = await this.service.pdfData(context, id);
    if (data.status !== "sent") {
      throw new ConflictException({
        statusCode: 409,
        code: "quote_not_sendable",
        message: "Only a quote that was marked as sent can be e-mailed. Mark it as sent first.",
      });
    }
    const to = body.to ?? data.customerEmail;
    if (!to) {
      throw new ValidationFailedError([
        {
          path: "to",
          message: "the customer has no contact e-mail; enter an address",
          code: "required",
        },
      ]);
    }
    const bytes = await renderQuotePdf(data);
    const content = quoteMail({
      senderName: data.issuer,
      customerName: data.customerName,
      reference: data.reference,
      validUntil: usDate(data.validUntil),
    });
    const outcome = await this.mail.send(context, {
      kind: "quote",
      relatedId: id,
      message: {
        to,
        ...content,
        attachments: [
          {
            filename: `${data.reference}.pdf`,
            content: Buffer.from(bytes),
            contentType: "application/pdf",
          },
        ],
      },
    });
    return { to, ...outcome };
  }

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

  @Get(":id/pdf")
  @RequirePermissions("quote:read")
  @ApiRoute({
    summary:
      "The quote as a PDF for the customer: issuer, customer, service, price, validity and terms. No cost or margin.",
    response: z.any(),
  })
  async pdf(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const data = await this.service.pdfData(contextOf(request), id);
    const bytes = await renderQuotePdf(data);
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="${data.reference}.pdf"`);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "private, no-store");
    return new StreamableFile(bytes);
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
