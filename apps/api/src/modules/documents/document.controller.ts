import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import { RequirePermissions } from "../../platform/access.ts";
import { idParamSchema } from "../../platform/directory-http.ts";
import { ApiRoute } from "../../platform/openapi.ts";
import { requireTenant, type TenantRequest } from "../../platform/request-context.ts";
import { ZodPipe } from "../../platform/validation.ts";
import {
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  type DocumentService,
  type DocumentSummary,
} from "./document-service.ts";
import { DOCUMENT_SERVICE } from "./tokens.ts";

const summarySchema = z.object({
  id: z.uuid(),
  transportId: z.uuid(),
  type: z.enum(DOCUMENT_TYPES),
  filename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  uploadedBy: z.object({ id: z.uuid(), displayName: z.string() }),
  createdAt: z.iso.datetime(),
});

const listSchema = z.object({ items: z.array(summarySchema) });
const deletedSchema = z.object({ id: z.uuid() });

function contextOf(request: TenantRequest & { id?: unknown }) {
  const { auth, tenant } = requireTenant(request);
  return {
    organizationId: tenant.organizationId,
    userId: auth.user.id,
    requestId: typeof request.id === "string" ? request.id : undefined,
  };
}

@Controller("v1")
export class DocumentController {
  constructor(@Inject(DOCUMENT_SERVICE) private readonly service: DocumentService) {}

  @Get("transports/:id/documents")
  @RequirePermissions("document:read")
  @ApiRoute({ summary: "Documents attached to a transport, newest first", response: listSchema })
  async list(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<{ items: DocumentSummary[] }> {
    return { items: await this.service.list(contextOf(request), id) };
  }

  @Post("transports/:id/documents")
  @HttpCode(201)
  @RequirePermissions("document:manage")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 5 } }),
  )
  @ApiRoute({
    summary:
      "Upload a file (multipart form with the fields `file` and `type`). PDF, JPEG, PNG, WebP or HEIC, up to 10 MB; the type is detected from the content.",
    response: summarySchema,
    status: 201,
  })
  upload(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined,
    @Body() body: { type?: unknown },
  ): Promise<DocumentSummary> {
    return this.service.upload(
      contextOf(request),
      id,
      file,
      typeof body.type === "string" ? body.type : "",
    );
  }

  @Get("documents/:id/download")
  @RequirePermissions("document:read")
  @ApiRoute({ summary: "Download a file. The response is the file itself.", response: z.any() })
  async download(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.service.download(contextOf(request), id);
    // The file is served as a download, never rendered by the browser as part of our origin.
    response.setHeader("Content-Type", file.contentType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    response.setHeader("Cache-Control", "private, no-store");
    return new StreamableFile(file.body);
  }

  @Delete("documents/:id")
  @RequirePermissions("document:manage")
  @ApiRoute({ summary: "Remove a document from its transport", response: deletedSchema })
  remove(
    @Req() request: TenantRequest,
    @Param("id", new ZodPipe(idParamSchema)) id: string,
  ): Promise<{ id: string }> {
    return this.service.remove(contextOf(request), id);
  }
}
