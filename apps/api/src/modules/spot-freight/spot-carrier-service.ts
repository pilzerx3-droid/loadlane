import { ConflictException, GoneException, NotFoundException } from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import type pg from "pg";
import { hashCapabilityToken } from "../../platform/capability-token.ts";
import type { CarrierOffer } from "./spot.schemas.ts";
import { transportRef } from "./spot-service.ts";

type Row = Record<string, unknown>;

interface Grant {
  invitationId: string;
  organizationId: string;
  tenderId: string;
  carrierId: string;
}

/**
 * What an invited carrier can do through its link (ADR 0019): see the lane, send a price, withdraw
 * it. The carrier never sees the customer, the shipper's target price, other carriers or their prices.
 */
export class SpotCarrierService {
  constructor(private readonly pool: pg.Pool) {}

  /** Finds the invitation by the hash of the token. Unknown 404, revoked or expired 410. */
  async resolve(token: unknown): Promise<Grant> {
    if (typeof token !== "string" || token.length < 20 || token.length > 200) throw this.invalid();
    const row = await withTenant(
      this.pool,
      { spotTokenHash: hashCapabilityToken(token) },
      async ({ client }) => {
        const result = await client.query<Row>(
          "SELECT id, organization_id, tender_id, carrier_id, expires_at <= now() AS expired, revoked_at FROM spot_invitation",
        );
        return result.rows[0];
      },
    );
    if (!row) throw this.invalid();
    if (row["revoked_at"] || row["expired"] === true) {
      throw new GoneException({
        statusCode: 410,
        code: row["revoked_at"] ? "spot_link_revoked" : "spot_link_expired",
        message: "This link is no longer active. Ask the shipper for a new one.",
      });
    }
    return {
      invitationId: row["id"] as string,
      organizationId: row["organization_id"] as string,
      tenderId: row["tender_id"] as string,
      carrierId: row["carrier_id"] as string,
    };
  }

  async offer(token: unknown): Promise<CarrierOffer> {
    const grant = await this.resolve(token);
    return withTenant(this.pool, { organizationId: grant.organizationId }, (s) =>
      this.load(s.client, grant),
    );
  }

  async submit(
    token: unknown,
    priceCents: number,
    note: string | null | undefined,
  ): Promise<CarrierOffer> {
    const grant = await this.resolve(token);
    return withTenant(this.pool, { organizationId: grant.organizationId }, async ({ client }) => {
      await this.requireBiddable(client, grant);
      await client.query(
        "UPDATE spot_bid SET status = 'superseded' WHERE tender_id = $1 AND carrier_id = $2 AND status = 'submitted'",
        [grant.tenderId, grant.carrierId],
      );
      await client.query(
        `INSERT INTO spot_bid (organization_id, tender_id, carrier_id, invitation_id, price_cents, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          grant.organizationId,
          grant.tenderId,
          grant.carrierId,
          grant.invitationId,
          priceCents,
          note ?? null,
        ],
      );
      await this.audit(client, grant, "spot_tender.bid_received", { priceCents });
      return this.load(client, grant);
    });
  }

  async withdraw(token: unknown): Promise<CarrierOffer> {
    const grant = await this.resolve(token);
    return withTenant(this.pool, { organizationId: grant.organizationId }, async ({ client }) => {
      await this.requireBiddable(client, grant);
      const result = await client.query(
        "UPDATE spot_bid SET status = 'withdrawn' WHERE tender_id = $1 AND carrier_id = $2 AND status = 'submitted'",
        [grant.tenderId, grant.carrierId],
      );
      if ((result.rowCount ?? 0) > 0)
        await this.audit(client, grant, "spot_tender.bid_withdrawn", {});
      return this.load(client, grant);
    });
  }

  /** Bids are accepted while the offer is open and the deadline has not passed. */
  private async requireBiddable(client: pg.PoolClient, grant: Grant): Promise<void> {
    const tender = await client.query<Row>(
      "SELECT status, response_deadline < now() AS passed FROM spot_tender WHERE id = $1 FOR SHARE",
      [grant.tenderId],
    );
    const row = tender.rows[0];
    if (!row) throw this.invalid();
    if (row["status"] !== "open") {
      throw new ConflictException({
        statusCode: 409,
        code: "spot_closed",
        message: "This offer is closed.",
      });
    }
    if (row["passed"] === true) {
      throw new ConflictException({
        statusCode: 409,
        code: "deadline_passed",
        message: "The response deadline has passed.",
      });
    }
  }

  private async load(client: pg.PoolClient, grant: Grant): Promise<CarrierOffer> {
    const tender = await client.query<Row>(
      `SELECT t.status, t.response_deadline, t.response_deadline < now() AS passed,
              tr.number, tr.weight_lb, tr.pieces, tr.id AS transport_id
       FROM spot_tender t JOIN transport tr ON tr.id = t.transport_id AND tr.organization_id = t.organization_id
       WHERE t.id = $1`,
      [grant.tenderId],
    );
    const row = tender.rows[0];
    if (!row) throw this.invalid();
    const stops = await client.query<Row>(
      `SELECT s.sequence, s.type, s.window_start, s.window_end, l.city, l.state, l.timezone
       FROM stop s JOIN location l ON l.id = s.location_id
       WHERE s.transport_id = $1 ORDER BY s.sequence`,
      [row["transport_id"]],
    );
    const bids = await client.query<Row>(
      `SELECT price_cents, note, status, created_at FROM spot_bid
       WHERE tender_id = $1 AND carrier_id = $2 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [grant.tenderId, grant.carrierId],
    );
    const bid = bids.rows[0];
    const awardedToYou = bid?.["status"] === "awarded";
    const state: CarrierOffer["state"] = awardedToYou
      ? "awarded_to_you"
      : row["status"] !== "open"
        ? "closed"
        : row["passed"] === true
          ? "deadline_passed"
          : "open";
    return {
      state,
      transportReference: transportRef(Number(row["number"])),
      responseDeadline: (row["response_deadline"] as Date).toISOString(),
      weightLb: row["weight_lb"] === null ? null : Number(row["weight_lb"]),
      pieces: row["pieces"] as number | null,
      stops: stops.rows.map((stop) => ({
        sequence: stop["sequence"] as number,
        type: stop["type"] as "pickup" | "delivery",
        city: stop["city"] as string,
        state: stop["state"] as string,
        windowStart: (stop["window_start"] as Date).toISOString(),
        windowEnd: (stop["window_end"] as Date).toISOString(),
        timezone: stop["timezone"] as string,
      })),
      yourBid: bid
        ? {
            priceCents: Number(bid["price_cents"]),
            note: bid["note"] as string | null,
            status: bid["status"] as NonNullable<CarrierOffer["yourBid"]>["status"],
            createdAt: (bid["created_at"] as Date).toISOString(),
          }
        : null,
    };
  }

  private invalid(): NotFoundException {
    return new NotFoundException({
      statusCode: 404,
      code: "spot_link_invalid",
      message: "This link is not valid.",
    });
  }

  /** Carrier actions are audited as system actions that name the invitation; the token never appears. */
  private async audit(
    client: pg.PoolClient,
    grant: Grant,
    action: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (organization_id, actor_type, action, entity_type, entity_id, changes)
       VALUES ($1, 'system', $2, 'spot_tender', $3, $4)`,
      [
        grant.organizationId,
        action,
        grant.tenderId,
        JSON.stringify({
          ...changes,
          invitationId: grant.invitationId,
          carrierId: grant.carrierId,
        }),
      ],
    );
  }
}
