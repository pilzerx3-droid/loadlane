import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appUser } from "./app-user.ts";
import { createdAtColumn, idColumn } from "./columns.ts";
import { organization } from "./organization.ts";
import { transport } from "./transport.ts";

/** There is deliberately no CMR: Loadlane is US first (ADR 0005). */
export const documentTypeEnum = pgEnum("document_type", [
  "delivery_note",
  "bill_of_lading",
  "proof_of_delivery",
  "photo",
  "other",
]);

/**
 * Metadata of a file attached to a transport. The file itself lives in S3-compatible storage under
 * `storage_key`. Documents are removed by setting `deleted_at`; the stored object is kept.
 */
export const document = pgTable(
  "document",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    transportId: uuid("transport_id").notNull(),
    type: documentTypeEnum("type").notNull(),
    /** The name the file had when it was uploaded, for display and download. */
    filename: text("filename").notNull(),
    /** Detected from the file's content, not taken from the upload. */
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAtColumn(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    deletedByUserId: uuid("deleted_by_user_id").references(() => appUser.id),
  },
  (t) => [
    unique("document_id_org_key").on(t.id, t.organizationId),
    unique("document_storage_key_key").on(t.storageKey),
    foreignKey({
      name: "document_transport_org_fk",
      columns: [t.transportId, t.organizationId],
      foreignColumns: [transport.id, transport.organizationId],
    }),
    foreignKey({
      name: "document_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    check("document_size_positive", sql`${t.sizeBytes} > 0`),
    check(
      "document_deleted_consistent",
      sql`(${t.deletedAt} IS NULL) = (${t.deletedByUserId} IS NULL)`,
    ),
    index("document_org_transport_idx").on(t.organizationId, t.transportId, t.createdAt),
  ],
);
