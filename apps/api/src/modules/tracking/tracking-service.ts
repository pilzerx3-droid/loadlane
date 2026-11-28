import { ConflictException, GoneException, NotFoundException } from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import type pg from "pg";
import { hashCapabilityToken, newCapabilityToken } from "../../platform/capability-token.ts";
import { ValidationFailedError } from "../../platform/validation.ts";

export const DEFAULT_TRACKING_DAYS = 30;
export const MAX_TRACKING_DAYS = 90;

export interface TrackingContext {
  organizationId: string;
  userId: string;
  requestId?: string | undefined;
}

export type TrackingLinkState = "active" | "expired" | "revoked";

export interface TrackingLinkSummary {
  id: string;
  transportId: string;
  state: TrackingLinkState;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
  createdBy: { id: string; displayName: string };
}

export interface CreatedTrackingLink extends TrackingLinkSummary {
  token: string;
}

/** What the customer's page may show. Nothing else leaves the API through a tracking link. */
export interface PublicTrackingView {
  reference: string;
  customerReference: string | null;
  status: string;
  stops: {
    sequence: number;
    type: "pickup" | "delivery";
    placeName: string;
    city: string;
    state: string;
    windowStart: string;
    windowEnd: string;
    timezone: string;
  }[];
  history: { status: string; occurredAt: string }[];
}

type Row = Record<string, unknown>;

function summaryOf(row: Row): TrackingLinkSummary {
  const expiresAt = row["expires_at"] as Date;
  const revokedAt = row["revoked_at"] as Date | null;
  return {
    id: row["id"] as string,
    transportId: row["transport_id"] as string,
    state: revokedAt ? "revoked" : expiresAt <= new Date() ? "expired" : "active",
    expiresAt: expiresAt.toISOString(),
    createdAt: (row["created_at"] as Date).toISOString(),
    revokedAt: revokedAt ? revokedAt.toISOString() : null,
    createdBy: {
      id: row["created_by_user_id"] as string,
      displayName: row["display_name"] as string,
    },
  };
}

const SELECT = `SELECT l.id, l.transport_id, l.expires_at, l.revoked_at, l.created_at, l.created_by_user_id, u.display_name
  FROM tracking_link l JOIN app_user u ON u.id = l.created_by_user_id`;

/** Customer tracking links (ADR 0017): staff side (create, list, revoke) and the public view. */
export class TrackingService {
  constructor(private readonly pool: pg.Pool) {}

  async create(
    context: TrackingContext,
    transportId: string,
    expiresInDays: number | undefined,
  ): Promise<CreatedTrackingLink> {
    const days = expiresInDays ?? DEFAULT_TRACKING_DAYS;
    if (!Number.isInteger(days) || days < 1 || days > MAX_TRACKING_DAYS) {
      throw new ValidationFailedError([
        {
          path: "expiresInDays",
          message: `must be a whole number from 1 to ${MAX_TRACKING_DAYS}`,
          code: "invalid_value",
        },
      ]);
    }
    const token = newCapabilityToken();
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const transport = await client.query<Row>("SELECT status FROM transport WHERE id = $1", [
        transportId,
      ]);
      const status = transport.rows[0]?.["status"] as string | undefined;
      if (!status) throw new NotFoundException();
      if (status === "cancelled") {
        throw new ConflictException({
          statusCode: 409,
          code: "transport_closed",
          message: "A cancelled transport cannot get a tracking link.",
        });
      }
      const inserted = await client.query<Row>(
        `INSERT INTO tracking_link (organization_id, transport_id, token_hash, expires_at, created_by_user_id)
         VALUES ($1, $2, $3, now() + make_interval(days => $4), $5) RETURNING id`,
        [context.organizationId, transportId, hashCapabilityToken(token), days, context.userId],
      );
      const id = (inserted.rows[0] as Row)["id"] as string;
      const rows = await client.query<Row>(`${SELECT} WHERE l.id = $1`, [id]);
      const summary = summaryOf(rows.rows[0] ?? {});
      await this.audit(client, context, "tracking_link.created", id, {
        transportId,
        expiresAt: summary.expiresAt,
      });
      return { ...summary, token };
    });
  }

  async list(context: TrackingContext, transportId: string): Promise<TrackingLinkSummary[]> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const transport = await client.query("SELECT 1 FROM transport WHERE id = $1", [transportId]);
      if (transport.rowCount === 0) throw new NotFoundException();
      const rows = await client.query<Row>(
        `${SELECT} WHERE l.transport_id = $1 ORDER BY l.created_at DESC, l.id DESC`,
        [transportId],
      );
      return rows.rows.map(summaryOf);
    });
  }

  async revoke(context: TrackingContext, id: string): Promise<TrackingLinkSummary> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const found = await client.query("SELECT 1 FROM tracking_link WHERE id = $1", [id]);
      if (found.rowCount === 0) throw new NotFoundException();
      const result = await client.query(
        "UPDATE tracking_link SET revoked_at = now(), revoked_by_user_id = $2 WHERE id = $1 AND revoked_at IS NULL",
        [id, context.userId],
      );
      if (result.rowCount === 1) await this.audit(client, context, "tracking_link.revoked", id, {});
      const rows = await client.query<Row>(`${SELECT} WHERE l.id = $1`, [id]);
      return summaryOf(rows.rows[0] ?? {});
    });
  }

  /** The customer's view. Unknown tokens are 404, revoked or expired links 410. */
  async view(token: unknown): Promise<PublicTrackingView> {
    if (typeof token !== "string" || token.length < 20 || token.length > 200) {
      throw this.invalid();
    }
    const link = await withTenant(
      this.pool,
      { trackingTokenHash: hashCapabilityToken(token) },
      async ({ client }) => {
        const result = await client.query<Row>(
          "SELECT organization_id, transport_id, expires_at <= now() AS expired, revoked_at FROM tracking_link",
        );
        return result.rows[0];
      },
    );
    if (!link) throw this.invalid();
    if (link["revoked_at"] || link["expired"] === true) {
      throw new GoneException({
        statusCode: 410,
        code: link["revoked_at"] ? "tracking_link_revoked" : "tracking_link_expired",
        message: "This tracking link is no longer active.",
      });
    }
    const organizationId = link["organization_id"] as string;
    const transportId = link["transport_id"] as string;
    return withTenant(this.pool, { organizationId }, async ({ client }) => {
      const transport = await client.query<Row>(
        "SELECT number, status, customer_reference FROM transport WHERE id = $1",
        [transportId],
      );
      const row = transport.rows[0];
      if (!row) throw this.invalid();
      const stops = await client.query<Row>(
        `SELECT s.sequence, s.type, s.window_start, s.window_end, l.name, l.city, l.state, l.timezone
         FROM stop s JOIN location l ON l.id = s.location_id
         WHERE s.transport_id = $1 ORDER BY s.sequence`,
        [transportId],
      );
      const events = await client.query<Row>(
        "SELECT to_status, occurred_at FROM transport_event WHERE transport_id = $1 ORDER BY occurred_at, id",
        [transportId],
      );
      return {
        reference: `LL-${String(Number(row["number"])).padStart(6, "0")}`,
        customerReference: row["customer_reference"] as string | null,
        status: row["status"] as string,
        stops: stops.rows.map((stop) => ({
          sequence: stop["sequence"] as number,
          type: stop["type"] as "pickup" | "delivery",
          placeName: stop["name"] as string,
          city: stop["city"] as string,
          state: stop["state"] as string,
          windowStart: (stop["window_start"] as Date).toISOString(),
          windowEnd: (stop["window_end"] as Date).toISOString(),
          timezone: stop["timezone"] as string,
        })),
        history: events.rows.map((event) => ({
          status: event["to_status"] as string,
          occurredAt: (event["occurred_at"] as Date).toISOString(),
        })),
      };
    });
  }

  private invalid(): NotFoundException {
    return new NotFoundException({
      statusCode: 404,
      code: "tracking_link_invalid",
      message: "This tracking link is not valid.",
    });
  }

  private tenant(context: TrackingContext) {
    return { organizationId: context.organizationId, userId: context.userId };
  }

  private async audit(
    client: pg.PoolClient,
    context: TrackingContext,
    action: string,
    entityId: string,
    changes: unknown,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (organization_id, actor_type, actor_user_id, action, entity_type, entity_id, changes, request_id)
       VALUES ($1, 'user', $2, $3, 'tracking_link', $4, $5, $6)`,
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
