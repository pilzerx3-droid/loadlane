import { randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import type pg from "pg";
import type { ObjectStorage } from "../../platform/object-storage.ts";
import { ValidationFailedError } from "../../platform/validation.ts";
import { safeFilename, sniffFile } from "./sniff.ts";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const DOCUMENT_TYPES = [
  "delivery_note",
  "bill_of_lading",
  "proof_of_delivery",
  "photo",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface DocumentContext {
  organizationId: string;
  userId: string;
  requestId?: string | undefined;
}

/** A driver acting through a Driver Link (ADR 0015): the organization comes from the link. */
export interface DriverUploadContext {
  organizationId: string;
  driverLinkId: string;
}
export interface DocumentSummary {
  id: string;
  transportId: string;
  type: DocumentType;
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** Null when the file came from a driver through a Driver Link. */
  uploadedBy: { id: string; displayName: string } | null;
  uploadedByDriver: boolean;
  createdAt: string;
}

type Row = Record<string, unknown>;

function summaryOf(row: Row): DocumentSummary {
  return {
    id: row["id"] as string,
    transportId: row["transport_id"] as string,
    type: row["type"] as DocumentType,
    filename: row["filename"] as string,
    contentType: row["content_type"] as string,
    sizeBytes: Number(row["size_bytes"]),
    uploadedBy:
      row["uploaded_by_user_id"] === null
        ? null
        : {
            id: row["uploaded_by_user_id"] as string,
            displayName: row["display_name"] as string,
          },
    uploadedByDriver: row["uploaded_by_user_id"] === null,
    createdAt: (row["created_at"] as Date).toISOString(),
  };
}

const COLUMNS = `d.id, d.transport_id, d.type, d.filename, d.content_type, d.size_bytes, d.uploaded_by_user_id, u.display_name, d.created_at`;
const FROM_DOCUMENT = "document d LEFT JOIN app_user u ON u.id = d.uploaded_by_user_id";

/**
 * Files attached to a transport. Metadata lives in the database under row-level security, the bytes
 * in object storage. Every call is checked against the caller's organization; downloads go through
 * the API, so the permission is checked for every file.
 */
export class DocumentService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly storage: ObjectStorage,
  ) {}

  async list(context: DocumentContext, transportId: string): Promise<DocumentSummary[]> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const transport = await client.query("SELECT 1 FROM transport WHERE id = $1", [transportId]);
      if (transport.rowCount === 0) throw new NotFoundException();
      const rows = await client.query<Row>(
        `SELECT ${COLUMNS} FROM ${FROM_DOCUMENT}
         WHERE d.transport_id = $1 AND d.deleted_at IS NULL ORDER BY d.created_at DESC, d.id DESC`,
        [transportId],
      );
      return rows.rows.map(summaryOf);
    });
  }

  async upload(
    context: DocumentContext,
    transportId: string,
    file: { originalname: string; buffer: Buffer } | undefined,
    type: string,
  ): Promise<DocumentSummary> {
    return this.store({ kind: "user", context }, transportId, file, type);
  }

  /** A driver's upload through a Driver Link. The caller resolved the link; the transport is the link's own. */
  async uploadFromDriver(
    context: DriverUploadContext,
    transportId: string,
    file: { originalname: string; buffer: Buffer } | undefined,
    type: string,
  ): Promise<DocumentSummary> {
    return this.store({ kind: "driver", context }, transportId, file, type);
  }

  private async store(
    actor:
      { kind: "user"; context: DocumentContext } | { kind: "driver"; context: DriverUploadContext },
    transportId: string,
    file: { originalname: string; buffer: Buffer } | undefined,
    type: string,
  ): Promise<DocumentSummary> {
    const { organizationId } = actor.context;
    if (!file || file.buffer.length === 0) {
      throw new ValidationFailedError([
        { path: "file", message: "choose a file to upload", code: "required" },
      ]);
    }
    if (!(DOCUMENT_TYPES as readonly string[]).includes(type)) {
      throw new ValidationFailedError([
        {
          path: "type",
          message: `must be one of ${DOCUMENT_TYPES.join(", ")}`,
          code: "invalid_value",
        },
      ]);
    }
    const detected = sniffFile(file.buffer);
    if (!detected) {
      throw new ValidationFailedError([
        {
          path: "file",
          message: "only PDF, JPEG, PNG, WebP and HEIC files are accepted",
          code: "unsupported_file_type",
        },
      ]);
    }

    const id = randomUUID();
    const storageKey = `org/${organizationId}/transport/${transportId}/${id}`;
    const tenant = actor.kind === "user" ? this.tenant(actor.context) : { organizationId };
    return withTenant(this.pool, tenant, async ({ client }) => {
      const transport = await client.query("SELECT 1 FROM transport WHERE id = $1", [transportId]);
      if (transport.rowCount === 0) throw new NotFoundException();
      await client.query(
        `INSERT INTO document (id, organization_id, transport_id, type, filename, content_type, size_bytes, storage_key, uploaded_by_user_id, uploaded_by_driver_link_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          organizationId,
          transportId,
          type,
          safeFilename(file.originalname),
          detected.contentType,
          file.buffer.length,
          storageKey,
          actor.kind === "user" ? actor.context.userId : null,
          actor.kind === "driver" ? actor.context.driverLinkId : null,
        ],
      );
      // The file is stored before the transaction commits: if storing fails, no row is left behind.
      await this.storage.put(storageKey, file.buffer, detected.contentType);
      const changes = {
        transportId,
        type,
        sizeBytes: file.buffer.length,
        contentType: detected.contentType,
      };
      if (actor.kind === "user") {
        await this.audit(client, actor.context, "document.uploaded", id, changes);
      } else {
        await client.query(
          `INSERT INTO audit_log (organization_id, actor_type, action, entity_type, entity_id, changes)
           VALUES ($1, 'system', 'document.uploaded', 'document', $2, $3)`,
          [
            organizationId,
            id,
            JSON.stringify({ ...changes, driverLinkId: actor.context.driverLinkId }),
          ],
        );
      }
      const row = await client.query<Row>(
        `SELECT ${COLUMNS} FROM ${FROM_DOCUMENT} WHERE d.id = $1`,
        [id],
      );
      return summaryOf(row.rows[0] ?? {});
    });
  }

  async download(
    context: DocumentContext,
    id: string,
  ): Promise<{ filename: string; contentType: string; body: Buffer }> {
    const meta = await withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const result = await client.query<Row>(
        "SELECT filename, content_type, storage_key FROM document WHERE id = $1 AND deleted_at IS NULL",
        [id],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException();
      await this.audit(client, context, "document.downloaded", id, {});
      return row;
    });
    const stored = await this.storage.get(meta["storage_key"] as string);
    return {
      filename: meta["filename"] as string,
      contentType: meta["content_type"] as string,
      body: stored.body,
    };
  }

  /** Marks a document as deleted. The stored file is kept (retention is a legal question, ADR 0014). */
  async remove(context: DocumentContext, id: string): Promise<{ id: string }> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const result = await client.query(
        `UPDATE document SET deleted_at = now(), deleted_by_user_id = $2 WHERE id = $1 AND deleted_at IS NULL`,
        [id, context.userId],
      );
      if (result.rowCount === 0) throw new NotFoundException();
      await this.audit(client, context, "document.deleted", id, {});
      return { id };
    });
  }

  private tenant(context: DocumentContext) {
    return { organizationId: context.organizationId, userId: context.userId };
  }

  private async audit(
    client: pg.PoolClient,
    context: DocumentContext,
    action: string,
    entityId: string,
    changes: unknown,
  ): Promise<void> {
    // OPEN (legal, ADR 0002): ip and user agent are not recorded until their retention is decided.
    await client.query(
      `INSERT INTO audit_log (organization_id, actor_type, actor_user_id, action, entity_type, entity_id, changes, request_id)
       VALUES ($1, 'user', $2, $3, 'document', $4, $5, $6)`,
      [
        context.organizationId,
        context.userId,
        action,
        entityId,
        JSON.stringify(changes),
        context.requestId ?? null,
      ],
    );
  }
}
