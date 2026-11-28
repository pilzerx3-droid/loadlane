import { NotFoundException } from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import { etaIsCurrent, positionFreshness } from "@loadlane/shared";
import type pg from "pg";
import { GeoProviderError, type RoutingProvider } from "../../platform/geo-providers.ts";

export interface EtaContext {
  organizationId: string;
  userId: string;
}

/** Why no estimate was calculated this time. Stable codes: callers and tests branch on them. */
export type EtaRefreshResult =
  | { status: "updated" }
  | {
      status: "skipped";
      reason:
        | "routing_not_configured"
        | "transport_not_en_route"
        | "no_position"
        | "position_stale"
        | "destination_without_coordinates"
        | "recent_estimate";
    }
  | { status: "failed"; reason: "no_route" | "rate_limited" | "provider_error" };

export interface EtaView {
  /** null when no current estimate exists. */
  estimate: {
    estimatedArrival: string;
    computedAt: string;
    basedOnPositionAt: string;
    distanceMiles: number;
    drivingMinutes: number;
    provider: string;
    /** Always true here: stated in the response so no client presents it as more than it is. */
    excludesTrafficAndBreaks: true;
  } | null;
  routingConfigured: boolean;
}

type Row = Record<string, unknown>;

/** Transports on their way: an arrival estimate is only meaningful then. */
const EN_ROUTE = ["assigned", "confirmed", "loading", "in_transit"];

const METERS_PER_MILE = 1609.344;

/** How often an estimate may be refreshed per transport, to stay inside the routing provider's free quota. */
export const DEFAULT_ETA_REFRESH_MS = 10 * 60_000;

/**
 * Estimated arrival from a routing provider (ADR 0021): the driving time from the last reported
 * position to the final delivery stop. It runs after a position was stored, at most once per
 * refresh interval per transport. Without a provider, a position, or coordinates on the destination
 * there is no estimate: nothing is guessed.
 */
export class EtaService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly routing: RoutingProvider,
    private readonly refreshMs: number = DEFAULT_ETA_REFRESH_MS,
  ) {}

  async refresh(
    organizationId: string,
    transportId: string,
    now: Date = new Date(),
  ): Promise<EtaRefreshResult> {
    if (!this.routing.configured) return { status: "skipped", reason: "routing_not_configured" };
    const input = await withTenant(this.pool, { organizationId }, async ({ client }) => {
      const result = await client.query<Row>(
        `SELECT t.status,
                lp.latitude AS from_lat, lp.longitude AS from_lng, lp.recorded_at,
                dest.latitude AS to_lat, dest.longitude AS to_lng,
                e.computed_at AS last_computed
         FROM transport t
         LEFT JOIN last_position lp ON lp.transport_id = t.id AND lp.organization_id = t.organization_id
         LEFT JOIN LATERAL (
           SELECT l.latitude, l.longitude FROM stop s
           JOIN location l ON l.id = s.location_id AND l.organization_id = s.organization_id
           WHERE s.transport_id = t.id ORDER BY s.sequence DESC LIMIT 1
         ) dest ON true
         LEFT JOIN eta_estimate e ON e.transport_id = t.id AND e.organization_id = t.organization_id
         WHERE t.id = $1`,
        [transportId],
      );
      return result.rows[0];
    });
    if (!input || !EN_ROUTE.includes(input["status"] as string)) {
      return { status: "skipped", reason: "transport_not_en_route" };
    }
    const recordedAt = input["recorded_at"] as Date | null;
    if (!recordedAt) return { status: "skipped", reason: "no_position" };
    if (positionFreshness(recordedAt, now) === "stale") {
      return { status: "skipped", reason: "position_stale" };
    }
    if (input["to_lat"] === null || input["to_lng"] === null) {
      return { status: "skipped", reason: "destination_without_coordinates" };
    }
    const lastComputed = input["last_computed"] as Date | null;
    if (lastComputed && now.getTime() - lastComputed.getTime() < this.refreshMs) {
      return { status: "skipped", reason: "recent_estimate" };
    }
    const from = { latitude: input["from_lat"] as number, longitude: input["from_lng"] as number };
    const to = { latitude: input["to_lat"] as number, longitude: input["to_lng"] as number };
    let route;
    try {
      route = await this.routing.route(from, to);
    } catch (error) {
      if (error instanceof GeoProviderError) return { status: "failed", reason: error.code };
      throw error;
    }
    const distanceM = Math.round(route.distanceMeters);
    const durationS = Math.round(route.durationSeconds);
    const etaAt = new Date(recordedAt.getTime() + durationS * 1000);
    await withTenant(this.pool, { organizationId }, async ({ client }) => {
      await client.query(
        `INSERT INTO eta_estimate (organization_id, transport_id, computed_at, based_on_recorded_at, from_latitude, from_longitude, distance_m, duration_s, eta_at, provider)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'openrouteservice')
         ON CONFLICT (transport_id) DO UPDATE SET
           computed_at = EXCLUDED.computed_at, based_on_recorded_at = EXCLUDED.based_on_recorded_at,
           from_latitude = EXCLUDED.from_latitude, from_longitude = EXCLUDED.from_longitude,
           distance_m = EXCLUDED.distance_m, duration_s = EXCLUDED.duration_s,
           eta_at = EXCLUDED.eta_at, provider = EXCLUDED.provider`,
        [
          organizationId,
          transportId,
          now,
          recordedAt,
          from.latitude,
          from.longitude,
          distanceM,
          durationS,
          etaAt,
        ],
      );
    });
    return { status: "updated" };
  }

  /** The stored estimate of one transport, only while it is current. */
  async get(context: EtaContext, transportId: string, now: Date = new Date()): Promise<EtaView> {
    return withTenant(
      this.pool,
      { organizationId: context.organizationId, userId: context.userId },
      async ({ client }) => {
        const transport = await client.query("SELECT 1 FROM transport WHERE id = $1", [
          transportId,
        ]);
        if (transport.rowCount === 0) throw new NotFoundException();
        const result = await client.query<Row>(
          `SELECT computed_at, based_on_recorded_at, distance_m, duration_s, eta_at, provider
           FROM eta_estimate WHERE transport_id = $1`,
          [transportId],
        );
        const row = result.rows[0];
        if (!row || !etaIsCurrent(row["computed_at"] as Date, now)) {
          return { estimate: null, routingConfigured: this.routing.configured };
        }
        return {
          estimate: {
            estimatedArrival: (row["eta_at"] as Date).toISOString(),
            computedAt: (row["computed_at"] as Date).toISOString(),
            basedOnPositionAt: (row["based_on_recorded_at"] as Date).toISOString(),
            distanceMiles: Math.round((Number(row["distance_m"]) / METERS_PER_MILE) * 10) / 10,
            drivingMinutes: Math.round(Number(row["duration_s"]) / 60),
            provider: row["provider"] as string,
            excludesTrafficAndBreaks: true as const,
          },
          routingConfigured: this.routing.configured,
        };
      },
    );
  }
}
