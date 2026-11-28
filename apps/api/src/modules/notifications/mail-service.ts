import { ServiceUnavailableException } from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import type pg from "pg";
import type { MailMessage, MailProvider } from "../../platform/mail.ts";

export type MailKind = "tracking_link" | "spot_invitation" | "quote";

export interface MailContext {
  organizationId: string;
  userId: string;
}

export interface MailOutcome {
  status: "sent" | "failed";
  /** Stable code when the mail did not go out. Never the provider's raw message (it can name servers or accounts). */
  errorCode: "mail_send_failed" | null;
}

export interface MailLogEntry {
  id: string;
  kind: MailKind;
  relatedId: string | null;
  recipient: string;
  status: "sent" | "failed";
  errorCode: string | null;
  createdAt: string;
  sentBy: { id: string; displayName: string };
}

/**
 * Sends e-mail through the configured provider and keeps a log row per attempt (ADR 0021). The log
 * holds the recipient and the outcome, never the body, and never a link token.
 */
export class MailService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly provider: MailProvider,
    readonly appUrl: string,
  ) {}

  /** Call before doing work that would be wasted when mail cannot be sent. */
  assertConfigured(): void {
    if (this.provider.configured) return;
    throw new ServiceUnavailableException({
      statusCode: 503,
      code: "mail_not_configured",
      message: "E-mail is not configured on this server.",
    });
  }

  async send(
    context: MailContext,
    entry: { kind: MailKind; relatedId?: string; message: MailMessage },
  ): Promise<MailOutcome> {
    this.assertConfigured();
    let outcome: MailOutcome = { status: "sent", errorCode: null };
    let messageId: string | null = null;
    try {
      messageId = (await this.provider.send(entry.message)).messageId;
    } catch {
      outcome = { status: "failed", errorCode: "mail_send_failed" };
    }
    await withTenant(
      this.pool,
      { organizationId: context.organizationId, userId: context.userId },
      async ({ client }) => {
        await client.query(
          `INSERT INTO mail_log (organization_id, kind, related_id, recipient, status, error_code, provider_message_id, sent_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            context.organizationId,
            entry.kind,
            entry.relatedId ?? null,
            entry.message.to,
            outcome.status,
            outcome.errorCode,
            messageId,
            context.userId,
          ],
        );
      },
    );
    return outcome;
  }

  /** The name the organization appears under in mail it sends. */
  async senderName(context: MailContext): Promise<string> {
    return withTenant(
      this.pool,
      { organizationId: context.organizationId, userId: context.userId },
      async ({ client }) => {
        const row = await client.query<{ name: string }>(
          "SELECT name FROM organization WHERE id = $1",
          [context.organizationId],
        );
        return row.rows[0]?.name ?? "Your logistics partner";
      },
    );
  }

  async list(context: MailContext, limit = 100): Promise<MailLogEntry[]> {
    return withTenant(
      this.pool,
      { organizationId: context.organizationId, userId: context.userId },
      async ({ client }) => {
        const rows = await client.query<Record<string, unknown>>(
          `SELECT m.id, m.kind, m.related_id, m.recipient, m.status, m.error_code, m.created_at,
                  m.sent_by_user_id, u.display_name
           FROM mail_log m JOIN app_user u ON u.id = m.sent_by_user_id
           ORDER BY m.created_at DESC, m.id DESC LIMIT $1`,
          [limit],
        );
        return rows.rows.map((row) => ({
          id: row["id"] as string,
          kind: row["kind"] as MailKind,
          relatedId: row["related_id"] as string | null,
          recipient: row["recipient"] as string,
          status: row["status"] as "sent" | "failed",
          errorCode: row["error_code"] as string | null,
          createdAt: (row["created_at"] as Date).toISOString(),
          sentBy: {
            id: row["sent_by_user_id"] as string,
            displayName: row["display_name"] as string,
          },
        }));
      },
    );
  }
}
