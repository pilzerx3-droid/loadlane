import { createHash, randomBytes } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import type pg from "pg";
import { ValidationFailedError } from "../../platform/validation.ts";

/** A link stays valid this long after the last stop window ends (ADR 0015). */
export const LINK_GRACE_HOURS = 48;
export const MAX_LINK_HOURS = 24 * 30;

export interface DriverLinkContext {
  organizationId: string;
  userId: string;
  requestId?: string | undefined;
}

export type DriverLinkState = "active" | "expired" | "revoked";

export interface DriverLinkSummary {
  id: string;
  transportId: string;
  state: DriverLinkState;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
  createdBy: { id: string; displayName: string };
  /** What the driver decided about sharing a position, if they have seen the consent screen. */
  consent: { acceptedAt: string; withdrawnAt: string | null } | null;
}

/** Only returned when a link is created; the token cannot be read again. */
export interface CreatedDriverLink extends DriverLinkSummary {
  token: string;
}

type Row = Record<string, unknown>;

/** SHA-256 hex of a token: the only form in which tokens are stored or looked up. */
export function hashDriverToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function summaryOf(row: Row, now: Date): DriverLinkSummary {
  const expiresAt = row["expires_at"] as Date;
  const revokedAt = row["revoked_at"] as Date | null;
  const accepted = row["consent_accepted_at"] as Date | null;
  const withdrawn = row["consent_withdrawn_at"] as Date | null;
  return {
    id: row["id"] as string,
    transportId: row["transport_id"] as string,
    state: revokedAt ? "revoked" : expiresAt <= now ? "expired" : "active",
    expiresAt: expiresAt.toISOString(),
    createdAt: (row["created_at"] as Date).toISOString(),
    revokedAt: revokedAt ? revokedAt.toISOString() : null,
    createdBy: {
      id: row["created_by_user_id"] as string,
      displayName: row["display_name"] as string,
    },
    consent: accepted
      ? {
          acceptedAt: accepted.toISOString(),
          withdrawnAt: withdrawn ? withdrawn.toISOString() : null,
        }
      : null,
  };
}

const COLUMNS = `l.id, l.transport_id, l.expires_at, l.revoked_at, l.created_at, l.created_by_user_id, u.display_name,
  c.accepted_at AS consent_accepted_at, c.withdrawn_at AS consent_withdrawn_at`;

const FROM = `driver_link l JOIN app_user u ON u.id = l.created_by_user_id
  LEFT JOIN LATERAL (
    SELECT accepted_at, withdrawn_at FROM driver_consent
    WHERE driver_link_id = l.id ORDER BY accepted_at DESC, id DESC LIMIT 1
  ) c ON true`;

/** Creates, lists and revokes Driver Links. Driver-side access to a link is a separate concern (P3-03). */
export class DriverLinkService {
  constructor(private readonly pool: pg.Pool) {}

  async create(
    context: DriverLinkContext,
    transportId: string,
    expiresInHours?: number,
  ): Promise<CreatedDriverLink> {
    if (
      expiresInHours !== undefined &&
      (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > MAX_LINK_HOURS)
    ) {
      throw new ValidationFailedError([
        {
          path: "expiresInHours",
          message: `must be a whole number from 1 to ${MAX_LINK_HOURS}`,
          code: "invalid_value",
        },
      ]);
    }
    const token = randomBytes(32).toString("base64url");
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const transport = await client.query<Row>(
        `SELECT status, (SELECT max(window_end) FROM stop WHERE transport_id = $1) AS last_end
         FROM transport WHERE id = $1`,
        [transportId],
      );
      const row = transport.rows[0];
      if (!row) throw new NotFoundException();
      const status = row["status"] as string;
      if (status === "cancelled" || status === "completed") {
        throw new ConflictException({
          statusCode: 409,
          code: "transport_closed",
          message: `A transport that is ${status} cannot get a Driver Link.`,
        });
      }
      const inserted = await client.query<Row>(
        `INSERT INTO driver_link (organization_id, transport_id, token_hash, expires_at, created_by_user_id)
         VALUES ($1, $2, $3,
           CASE WHEN $4::int IS NULL
             THEN GREATEST(now(), coalesce($5::timestamptz, now())) + make_interval(hours => $6)
             ELSE now() + make_interval(hours => $4::int) END,
           $7)
         RETURNING id`,
        [
          context.organizationId,
          transportId,
          hashDriverToken(token),
          expiresInHours ?? null,
          row["last_end"] ?? null,
          LINK_GRACE_HOURS,
          context.userId,
        ],
      );
      const id = (inserted.rows[0] as Row)["id"] as string;
      const summary = await this.one(client, id);
      await this.audit(client, context, "driver_link.created", id, {
        transportId,
        expiresAt: summary.expiresAt,
      });
      return { ...summary, token };
    });
  }

  async list(context: DriverLinkContext, transportId: string): Promise<DriverLinkSummary[]> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const transport = await client.query("SELECT 1 FROM transport WHERE id = $1", [transportId]);
      if (transport.rowCount === 0) throw new NotFoundException();
      const rows = await client.query<Row>(
        `SELECT ${COLUMNS} FROM ${FROM}
         WHERE l.transport_id = $1 ORDER BY l.created_at DESC, l.id DESC`,
        [transportId],
      );
      const now = new Date();
      return rows.rows.map((row) => summaryOf(row, now));
    });
  }

  /** Stops a link at once. Revoking twice is harmless and keeps the first revocation. */
  async revoke(context: DriverLinkContext, id: string): Promise<DriverLinkSummary> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const found = await client.query("SELECT 1 FROM driver_link WHERE id = $1", [id]);
      if (found.rowCount === 0) throw new NotFoundException();
      const result = await client.query(
        `UPDATE driver_link SET revoked_at = now(), revoked_by_user_id = $2
         WHERE id = $1 AND revoked_at IS NULL`,
        [id, context.userId],
      );
      if (result.rowCount === 1) {
        await this.audit(client, context, "driver_link.revoked", id, {});
      }
      return this.one(client, id);
    });
  }

  private async one(client: pg.PoolClient, id: string): Promise<DriverLinkSummary> {
    const rows = await client.query<Row>(`SELECT ${COLUMNS} FROM ${FROM} WHERE l.id = $1`, [id]);
    return summaryOf(rows.rows[0] ?? {}, new Date());
  }

  private tenant(context: DriverLinkContext) {
    return { organizationId: context.organizationId, userId: context.userId };
  }

  private async audit(
    client: pg.PoolClient,
    context: DriverLinkContext,
    action: string,
    entityId: string,
    changes: unknown,
  ): Promise<void> {
    // The token is never part of the audit entry. OPEN (legal, ADR 0002): no ip or user agent.
    await client.query(
      `INSERT INTO audit_log (organization_id, actor_type, actor_user_id, action, entity_type, entity_id, changes, request_id)
       VALUES ($1, 'user', $2, $3, 'driver_link', $4, $5, $6)`,
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
