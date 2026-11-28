import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { appUser } from "./app-user.ts";
import { createdAtColumn, idColumn } from "./columns.ts";
import { organization } from "./organization.ts";

/**
 * One row per e-mail the application tried to send for an organization (ADR 0021). It records who
 * triggered it, which kind of mail it was, to which address and whether the mail server accepted it.
 * It never holds the body or a link token. Append only: a mail that was sent stays on record.
 */
export const mailLog = pgTable(
  "mail_log",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    /** What the mail was for. */
    kind: text("kind").notNull(),
    /** The record the mail is about (transport, spot tender or quote), when there is one. */
    relatedId: uuid("related_id"),
    recipient: text("recipient").notNull(),
    status: text("status").notNull(),
    /** Stable code of the failure, never the provider's raw message. */
    errorCode: text("error_code"),
    /** The id the mail server gave the message, to find it in its logs. */
    providerMessageId: text("provider_message_id"),
    sentByUserId: uuid("sent_by_user_id")
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique("mail_log_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      name: "mail_log_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    check("mail_log_kind", sql`${t.kind} IN ('tracking_link', 'spot_invitation', 'quote')`),
    check("mail_log_status", sql`${t.status} IN ('sent', 'failed')`),
    check("mail_log_recipient_length", sql`char_length(${t.recipient}) BETWEEN 3 AND 254`),
    index("mail_log_org_idx").on(t.organizationId, t.createdAt),
  ],
);
