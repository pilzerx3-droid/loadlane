import { ConflictException, NotFoundException } from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import { canTransition } from "@loadlane/shared";
import type pg from "pg";
import { hashCapabilityToken, newCapabilityToken } from "../../platform/capability-token.ts";
import { ValidationFailedError } from "../../platform/validation.ts";
import type {
  CreateTenderInput,
  CreatedTender,
  TenderDetail,
  TenderList,
  TenderListQuery,
  TenderSummary,
} from "./spot.schemas.ts";

export interface SpotContext {
  organizationId: string;
  userId: string;
  requestId?: string | undefined;
}

type Row = Record<string, unknown>;

export function transportRef(number: number): string {
  return `LL-${String(Number(number)).padStart(6, "0")}`;
}

const DEFAULT_INVITE_DAYS = 7;

/** Tender summary columns: lane, counts and the lowest live bid. */
const SUMMARY_SQL = `
  SELECT t.id, t.status, t.response_deadline, t.created_at, t.target_price_cents, t.notes, t.awarded_at,
         t.awarded_by_user_id, au.display_name AS awarded_by_name,
         tr.id AS transport_id, tr.number AS transport_number, tr.status AS transport_status,
         (SELECT l.city || ', ' || l.state FROM stop s JOIN location l ON l.id = s.location_id
           WHERE s.transport_id = tr.id ORDER BY s.sequence ASC LIMIT 1) AS origin,
         (SELECT l.city || ', ' || l.state FROM stop s JOIN location l ON l.id = s.location_id
           WHERE s.transport_id = tr.id ORDER BY s.sequence DESC LIMIT 1) AS destination,
         (SELECT count(*)::int FROM spot_invitation i WHERE i.tender_id = t.id) AS invited,
         (SELECT count(*)::int FROM spot_bid b WHERE b.tender_id = t.id AND b.status IN ('submitted', 'awarded')) AS live_bids,
         (SELECT min(b.price_cents) FROM spot_bid b WHERE b.tender_id = t.id AND b.status IN ('submitted', 'awarded')) AS lowest,
         (t.response_deadline < now()) AS deadline_passed
  FROM spot_tender t
  JOIN transport tr ON tr.id = t.transport_id AND tr.organization_id = t.organization_id
  LEFT JOIN app_user au ON au.id = t.awarded_by_user_id`;

function summaryOf(row: Row): TenderSummary {
  return {
    id: row["id"] as string,
    status: row["status"] as TenderSummary["status"],
    transport: {
      id: row["transport_id"] as string,
      reference: transportRef(Number(row["transport_number"])),
      status: row["transport_status"] as string,
    },
    origin: row["origin"] as string,
    destination: row["destination"] as string,
    responseDeadline: (row["response_deadline"] as Date).toISOString(),
    deadlinePassed: row["deadline_passed"] === true,
    invited: Number(row["invited"]),
    liveBids: Number(row["live_bids"]),
    lowestLiveBidCents: row["lowest"] === null ? null : Number(row["lowest"]),
    createdAt: (row["created_at"] as Date).toISOString(),
  };
}

/**
 * Spot freight on the shipper's side (ADR 0019): offer a transport to chosen carriers, take their
 * bids, award one. Awarding is always a human decision; nothing picks the cheapest bid.
 */
export class SpotService {
  constructor(private readonly pool: pg.Pool) {}

  async create(context: SpotContext, input: CreateTenderInput): Promise<CreatedTender> {
    const deadline = new Date(input.responseDeadline);
    if (deadline.getTime() <= Date.now()) {
      throw new ValidationFailedError([
        { path: "responseDeadline", message: "must be in the future", code: "invalid_value" },
      ]);
    }
    if (new Set(input.carrierIds).size !== input.carrierIds.length) {
      throw new ValidationFailedError([
        { path: "carrierIds", message: "each carrier only once", code: "invalid_value" },
      ]);
    }
    const tokens = new Map<string, string>();
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const transport = await client.query<Row>("SELECT status FROM transport WHERE id = $1", [
        input.transportId,
      ]);
      const status = transport.rows[0]?.["status"] as string | undefined;
      if (!status) {
        throw new ValidationFailedError([
          { path: "transportId", message: "not found", code: "invalid_reference" },
        ]);
      }
      if (status !== "created" && status !== "planned") {
        throw new ConflictException({
          statusCode: 409,
          code: "transport_not_offerable",
          message: "Only a transport that is created or planned can be offered to carriers.",
        });
      }
      const carriers = await client.query<Row>(
        "SELECT id FROM carrier WHERE id = ANY($1::uuid[]) AND archived_at IS NULL",
        [input.carrierIds],
      );
      if (carriers.rowCount !== input.carrierIds.length) {
        throw new ValidationFailedError([
          {
            path: "carrierIds",
            message: "a carrier was not found or is archived",
            code: "invalid_reference",
          },
        ]);
      }
      const open = await client.query(
        "SELECT 1 FROM spot_tender WHERE transport_id = $1 AND status = 'open'",
        [input.transportId],
      );
      if ((open.rowCount ?? 0) > 0) {
        throw new ConflictException({
          statusCode: 409,
          code: "tender_already_open",
          message: "This transport already has an open spot freight offer.",
        });
      }
      const inserted = await client.query<Row>(
        `INSERT INTO spot_tender (organization_id, transport_id, response_deadline, target_price_cents, notes, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          context.organizationId,
          input.transportId,
          deadline,
          input.targetPriceCents ?? null,
          input.notes ?? null,
          context.userId,
        ],
      );
      const id = (inserted.rows[0] as Row)["id"] as string;
      for (const carrierId of input.carrierIds) {
        const token = newCapabilityToken();
        tokens.set(carrierId, token);
        await this.insertInvitation(client, context, id, carrierId, token, input.inviteDays);
      }
      await this.audit(client, context, "spot_tender.created", id, {
        transportId: input.transportId,
        carriers: input.carrierIds.length,
      });
      const detail = await this.load(client, id);
      return {
        ...detail,
        links: input.carrierIds.map((carrierId) => ({
          carrierId,
          token: tokens.get(carrierId) ?? "",
        })),
      };
    });
  }

  async list(context: SpotContext, query: TenderListQuery): Promise<TenderList> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const params: unknown[] = [];
      let where = "";
      if (query.status && query.status.length > 0) {
        params.push(query.status);
        where = "WHERE t.status = ANY($1::spot_tender_status[])";
      }
      const total = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM spot_tender t ${where}`,
        params,
      );
      const rows = await client.query<Row>(
        `${SUMMARY_SQL} ${where} ORDER BY t.created_at DESC, t.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.limit, query.offset],
      );
      return {
        items: rows.rows.map(summaryOf),
        page: { limit: query.limit, offset: query.offset, total: total.rows[0]?.n ?? 0 },
      };
    });
  }

  async get(context: SpotContext, id: string): Promise<TenderDetail> {
    return withTenant(this.pool, this.tenant(context), (session) => this.load(session.client, id));
  }

  async invite(
    context: SpotContext,
    tenderId: string,
    carrierId: string,
    inviteDays: number | undefined,
  ): Promise<{ invitationId: string; carrierId: string; token: string; expiresAt: string }> {
    const token = newCapabilityToken();
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      await this.requireOpen(client, tenderId);
      const carrier = await client.query(
        "SELECT 1 FROM carrier WHERE id = $1 AND archived_at IS NULL",
        [carrierId],
      );
      if (carrier.rowCount === 0) {
        throw new ValidationFailedError([
          { path: "carrierId", message: "not found or archived", code: "invalid_reference" },
        ]);
      }
      const existing = await client.query(
        "SELECT 1 FROM spot_invitation WHERE tender_id = $1 AND carrier_id = $2",
        [tenderId, carrierId],
      );
      if ((existing.rowCount ?? 0) > 0) {
        throw new ConflictException({
          statusCode: 409,
          code: "already_invited",
          message: "This carrier was already invited to this offer.",
        });
      }
      const created = await this.insertInvitation(
        client,
        context,
        tenderId,
        carrierId,
        token,
        inviteDays,
      );
      await this.audit(client, context, "spot_tender.carrier_invited", tenderId, { carrierId });
      return { invitationId: created.id, carrierId, token, expiresAt: created.expiresAt };
    });
  }

  /** A price the shipper received by phone or e-mail. It replaces that carrier's earlier live bid. */
  async enterBid(
    context: SpotContext,
    tenderId: string,
    carrierId: string,
    priceCents: number,
    note: string | null | undefined,
  ): Promise<TenderDetail> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      await this.requireOpen(client, tenderId);
      const carrier = await client.query(
        "SELECT 1 FROM carrier WHERE id = $1 AND archived_at IS NULL",
        [carrierId],
      );
      if (carrier.rowCount === 0) {
        throw new ValidationFailedError([
          { path: "carrierId", message: "not found or archived", code: "invalid_reference" },
        ]);
      }
      await client.query(
        "UPDATE spot_bid SET status = 'superseded' WHERE tender_id = $1 AND carrier_id = $2 AND status = 'submitted'",
        [tenderId, carrierId],
      );
      await client.query(
        `INSERT INTO spot_bid (organization_id, tender_id, carrier_id, price_cents, note, entered_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [context.organizationId, tenderId, carrierId, priceCents, note ?? null, context.userId],
      );
      await this.audit(client, context, "spot_tender.bid_entered", tenderId, {
        carrierId,
        priceCents,
      });
      return this.load(client, tenderId);
    });
  }

  /**
   * Awards one bid: the carrier is set on the transport, which moves to assigned through the same
   * rules and history as any status change. Other live bids are rejected. Never automatic.
   */
  async award(
    context: SpotContext,
    tenderId: string,
    bidId: string,
    note: string | null | undefined,
  ): Promise<TenderDetail> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const tender = await this.requireOpen(client, tenderId);
      const bid = await client.query<Row>(
        "SELECT carrier_id, price_cents, status FROM spot_bid WHERE id = $1 AND tender_id = $2 FOR UPDATE",
        [bidId, tenderId],
      );
      const row = bid.rows[0];
      if (!row) {
        throw new ValidationFailedError([
          { path: "bidId", message: "not found", code: "invalid_reference" },
        ]);
      }
      if (row["status"] !== "submitted") {
        throw new ConflictException({
          statusCode: 409,
          code: "bid_not_live",
          message: "Only a bid that is currently valid can be awarded.",
        });
      }
      const transport = await client.query<Row>(
        "SELECT status FROM transport WHERE id = $1 FOR UPDATE",
        [tender["transport_id"]],
      );
      const from = transport.rows[0]?.["status"] as "created" | "planned" | undefined;
      // A transport that is still "created" passes through "planned": two steps of the normal status
      // model, each with its own history entry, so nothing is skipped silently.
      const route =
        from === "created" ? (["planned", "assigned"] as const) : (["assigned"] as const);
      if (!from || !canTransition(from, route[0])) {
        throw new ConflictException({
          statusCode: 409,
          code: "transport_not_offerable",
          message: "The transport has changed and can no longer be assigned from this offer.",
        });
      }
      await client.query("UPDATE spot_bid SET status = 'awarded' WHERE id = $1", [bidId]);
      await client.query(
        "UPDATE spot_bid SET status = 'rejected' WHERE tender_id = $1 AND status = 'submitted' AND id <> $2",
        [tenderId, bidId],
      );
      await client.query(
        "UPDATE spot_tender SET status = 'awarded', awarded_at = now(), awarded_by_user_id = $2 WHERE id = $1",
        [tenderId, context.userId],
      );
      await client.query(
        "UPDATE transport SET carrier_id = $2, status = 'assigned' WHERE id = $1",
        [tender["transport_id"], row["carrier_id"]],
      );
      const price = Number(row["price_cents"]);
      let previous: string = from;
      for (const next of route) {
        await client.query(
          `INSERT INTO transport_event (organization_id, transport_id, source, actor_user_id, from_status, to_status, note)
           VALUES ($1, $2, 'user', $3, $4, $5, $6)`,
          [
            context.organizationId,
            tender["transport_id"],
            context.userId,
            previous,
            next,
            next === "assigned"
              ? `Awarded through spot freight at $${(price / 100).toFixed(2)}${note ? `: ${note}` : ""}`
              : "Planned automatically when the spot freight offer was awarded",
          ],
        );
        previous = next;
      }
      await this.audit(client, context, "spot_tender.awarded", tenderId, {
        bidId,
        carrierId: row["carrier_id"],
        priceCents: price,
        transportId: tender["transport_id"],
        ...(note ? { note } : {}),
      });
      return this.load(client, tenderId);
    });
  }

  async cancel(context: SpotContext, tenderId: string): Promise<TenderDetail> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      await this.requireOpen(client, tenderId);
      await client.query(
        "UPDATE spot_tender SET status = 'cancelled', closed_at = now() WHERE id = $1",
        [tenderId],
      );
      await client.query(
        "UPDATE spot_bid SET status = 'rejected' WHERE tender_id = $1 AND status = 'submitted'",
        [tenderId],
      );
      await this.audit(client, context, "spot_tender.cancelled", tenderId, {});
      return this.load(client, tenderId);
    });
  }

  private async requireOpen(client: pg.PoolClient, tenderId: string): Promise<Row> {
    const result = await client.query<Row>("SELECT * FROM spot_tender WHERE id = $1 FOR UPDATE", [
      tenderId,
    ]);
    const tender = result.rows[0];
    if (!tender) throw new NotFoundException();
    if (tender["status"] !== "open") {
      throw new ConflictException({
        statusCode: 409,
        code: "tender_not_open",
        message: "This spot freight offer is no longer open.",
      });
    }
    return tender;
  }

  private async insertInvitation(
    client: pg.PoolClient,
    context: SpotContext,
    tenderId: string,
    carrierId: string,
    token: string,
    inviteDays: number | undefined,
  ): Promise<{ id: string; expiresAt: string }> {
    const result = await client.query<Row>(
      `INSERT INTO spot_invitation (organization_id, tender_id, carrier_id, token_hash, expires_at, created_by_user_id)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6) RETURNING id, expires_at`,
      [
        context.organizationId,
        tenderId,
        carrierId,
        hashCapabilityToken(token),
        inviteDays ?? DEFAULT_INVITE_DAYS,
        context.userId,
      ],
    );
    const row = result.rows[0] as Row;
    return { id: row["id"] as string, expiresAt: (row["expires_at"] as Date).toISOString() };
  }

  private async load(client: pg.PoolClient, id: string): Promise<TenderDetail> {
    const summary = await client.query<Row>(`${SUMMARY_SQL} WHERE t.id = $1`, [id]);
    const row = summary.rows[0];
    if (!row) throw new NotFoundException();
    const stops = await client.query<Row>(
      `SELECT s.sequence, s.type, s.window_start, s.window_end, l.name, l.city, l.state, l.timezone
       FROM stop s JOIN location l ON l.id = s.location_id
       WHERE s.transport_id = $1 ORDER BY s.sequence`,
      [row["transport_id"]],
    );
    const invitations = await client.query<Row>(
      `SELECT i.id, i.carrier_id, c.name, i.expires_at, i.revoked_at, (i.expires_at <= now()) AS expired
       FROM spot_invitation i JOIN carrier c ON c.id = i.carrier_id AND c.organization_id = i.organization_id
       WHERE i.tender_id = $1 ORDER BY i.created_at, i.id`,
      [id],
    );
    const bids = await client.query<Row>(
      `SELECT b.id, b.carrier_id, c.name, b.price_cents, b.note, b.status, b.entered_by_user_id, b.created_at
       FROM spot_bid b JOIN carrier c ON c.id = b.carrier_id AND c.organization_id = b.organization_id
       WHERE b.tender_id = $1 ORDER BY b.price_cents ASC, b.created_at ASC, b.id`,
      [id],
    );
    const awardedBy = row["awarded_by_user_id"] as string | null;
    const awardedAt = row["awarded_at"] as Date | null;
    return {
      ...summaryOf(row),
      targetPriceCents:
        row["target_price_cents"] === null ? null : Number(row["target_price_cents"]),
      notes: row["notes"] as string | null,
      awardedAt: awardedAt ? awardedAt.toISOString() : null,
      awardedBy: awardedBy
        ? { id: awardedBy, displayName: row["awarded_by_name"] as string }
        : null,
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
      invitations: invitations.rows.map((invitation) => ({
        id: invitation["id"] as string,
        carrier: { id: invitation["carrier_id"] as string, name: invitation["name"] as string },
        state: invitation["revoked_at"]
          ? "revoked"
          : invitation["expired"] === true
            ? "expired"
            : "active",
        expiresAt: (invitation["expires_at"] as Date).toISOString(),
      })),
      bids: bids.rows.map((bid) => ({
        id: bid["id"] as string,
        carrier: { id: bid["carrier_id"] as string, name: bid["name"] as string },
        priceCents: Number(bid["price_cents"]),
        note: bid["note"] as string | null,
        status: bid["status"] as TenderDetail["bids"][number]["status"],
        source: bid["entered_by_user_id"] ? "staff" : "carrier_link",
        createdAt: (bid["created_at"] as Date).toISOString(),
      })),
    };
  }

  private tenant(context: SpotContext) {
    return { organizationId: context.organizationId, userId: context.userId };
  }

  private async audit(
    client: pg.PoolClient,
    context: SpotContext,
    action: string,
    entityId: string,
    changes: unknown,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (organization_id, actor_type, actor_user_id, action, entity_type, entity_id, changes, request_id)
       VALUES ($1, 'user', $2, $3, 'spot_tender', $4, $5, $6)`,
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
