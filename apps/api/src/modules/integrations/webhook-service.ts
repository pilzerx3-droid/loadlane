import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { encryptSecret, newWebhookSecret, webhookUrlProblem, withTenant } from "@loadlane/db";
import type pg from "pg";
import { ValidationFailedError } from "../../platform/validation.ts";

export interface WebhookContext {
  organizationId: string;
  userId: string;
  requestId?: string | undefined;
}

export const WEBHOOK_EVENTS = [
  "transport.status_changed",
  "quote.status_changed",
  "spot.status_changed",
] as const;

export interface WebhookSummary {
  id: string;
  url: string;
  events: string[];
  state: "active" | "disabled";
  createdAt: string;
  disabledAt: string | null;
  createdBy: { id: string; displayName: string };
  /** Deliveries still waiting for a successful answer, and ones that gave up. */
  pending: number;
  failed: number;
}

export interface DeliverySummary {
  id: string;
  eventId: string;
  eventType: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  lastStatusCode: number | null;
  lastErrorCode: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

type Row = Record<string, unknown>;

const SELECT = `SELECT e.id, e.url, e.events, e.created_at, e.disabled_at, e.created_by_user_id, u.display_name,
  (SELECT count(*)::int FROM webhook_delivery d WHERE d.endpoint_id = e.id AND d.status = 'pending') AS pending,
  (SELECT count(*)::int FROM webhook_delivery d WHERE d.endpoint_id = e.id AND d.status = 'failed') AS failed
  FROM webhook_endpoint e JOIN app_user u ON u.id = e.created_by_user_id`;

function summaryOf(row: Row): WebhookSummary {
  const disabledAt = row["disabled_at"] as Date | null;
  return {
    id: row["id"] as string,
    url: row["url"] as string,
    events: row["events"] as string[],
    state: disabledAt ? "disabled" : "active",
    createdAt: (row["created_at"] as Date).toISOString(),
    disabledAt: disabledAt ? disabledAt.toISOString() : null,
    createdBy: {
      id: row["created_by_user_id"] as string,
      displayName: row["display_name"] as string,
    },
    pending: Number(row["pending"]),
    failed: Number(row["failed"]),
  };
}

/** Staff side of webhooks (ADR 0022): register an address, see it, switch it off, read its deliveries. */
export class WebhookService {
  constructor(
    private readonly pool: pg.Pool,
    /** Key that encrypts signing secrets. Without it webhooks cannot be created (503). */
    private readonly key: Buffer | undefined,
    private readonly allowPrivate: boolean,
  ) {}

  async create(
    context: WebhookContext,
    input: { url: string; events: string[] },
  ): Promise<WebhookSummary & { secret: string }> {
    if (!this.key) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: "webhooks_not_configured",
        message: "Webhooks are not configured on this server.",
      });
    }
    const problem = webhookUrlProblem(input.url, this.allowPrivate);
    if (problem) {
      throw new ValidationFailedError([{ path: "url", message: problem, code: "invalid_value" }]);
    }
    const secret = newWebhookSecret();
    return withTenant(
      this.pool,
      { organizationId: context.organizationId, userId: context.userId },
      async ({ client }) => {
        const inserted = await client.query<Row>(
          `INSERT INTO webhook_endpoint (organization_id, url, secret_encrypted, events, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            context.organizationId,
            input.url,
            encryptSecret(secret, this.key as Buffer),
            [...new Set(input.events)],
            context.userId,
          ],
        );
        const id = (inserted.rows[0] as Row)["id"] as string;
        await this.audit(client, context, "webhook_endpoint.created", id);
        const rows = await client.query<Row>(`${SELECT} WHERE e.id = $1`, [id]);
        return { ...summaryOf(rows.rows[0] ?? {}), secret };
      },
    );
  }

  async list(context: WebhookContext): Promise<WebhookSummary[]> {
    return withTenant(
      this.pool,
      { organizationId: context.organizationId, userId: context.userId },
      async ({ client }) => {
        const rows = await client.query<Row>(`${SELECT} ORDER BY e.created_at DESC, e.id DESC`);
        return rows.rows.map(summaryOf);
      },
    );
  }

  async disable(context: WebhookContext, id: string): Promise<WebhookSummary> {
    return withTenant(
      this.pool,
      { organizationId: context.organizationId, userId: context.userId },
      async ({ client }) => {
        const found = await client.query("SELECT 1 FROM webhook_endpoint WHERE id = $1", [id]);
        if (found.rowCount === 0) throw new NotFoundException();
        const result = await client.query(
          "UPDATE webhook_endpoint SET disabled_at = now(), disabled_by_user_id = $2 WHERE id = $1 AND disabled_at IS NULL",
          [id, context.userId],
        );
        if (result.rowCount === 1)
          await this.audit(client, context, "webhook_endpoint.disabled", id);
        const rows = await client.query<Row>(`${SELECT} WHERE e.id = $1`, [id]);
        return summaryOf(rows.rows[0] ?? {});
      },
    );
  }

  async deliveries(context: WebhookContext, id: string): Promise<DeliverySummary[]> {
    return withTenant(
      this.pool,
      { organizationId: context.organizationId, userId: context.userId },
      async ({ client }) => {
        const found = await client.query("SELECT 1 FROM webhook_endpoint WHERE id = $1", [id]);
        if (found.rowCount === 0) throw new NotFoundException();
        const rows = await client.query<Row>(
          `SELECT id, event_id, event_type, status, attempts, last_status_code, last_error_code, created_at, delivered_at
           FROM webhook_delivery WHERE endpoint_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`,
          [id],
        );
        return rows.rows.map((row) => ({
          id: row["id"] as string,
          eventId: row["event_id"] as string,
          eventType: row["event_type"] as string,
          status: row["status"] as DeliverySummary["status"],
          attempts: Number(row["attempts"]),
          lastStatusCode: row["last_status_code"] as number | null,
          lastErrorCode: row["last_error_code"] as string | null,
          createdAt: (row["created_at"] as Date).toISOString(),
          deliveredAt: row["delivered_at"] ? (row["delivered_at"] as Date).toISOString() : null,
        }));
      },
    );
  }

  private async audit(
    client: pg.PoolClient,
    context: WebhookContext,
    action: string,
    entityId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (organization_id, actor_type, actor_user_id, action, entity_type, entity_id, changes, request_id)
       VALUES ($1, 'user', $2, $3, 'webhook_endpoint', $4, '{}', $5)`,
      [context.organizationId, context.userId, action, entityId, context.requestId ?? null],
    );
  }
}
