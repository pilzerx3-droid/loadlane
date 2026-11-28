import { withTenant } from "@loadlane/db";
import type pg from "pg";
import { ValidationFailedError } from "../../platform/validation.ts";
import type { CommercialReport, ReportQuery } from "./report.schemas.ts";

export interface ReportContext {
  organizationId: string;
  userId: string;
}

type Row = Record<string, unknown>;

const MAX_DAYS = 366;

/** Basis points of numerator / denominator, rounded half up; null when the denominator is 0. */
export function rateBp(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  const sign = numerator < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(numerator) * 20_000 + denominator) / (2 * denominator));
}

/**
 * Figures from stored data only: nothing is estimated and nothing is shown that the data cannot
 * prove. A period is whole days in the organization's time zone.
 */
export class ReportService {
  constructor(private readonly pool: pg.Pool) {}

  async commercial(context: ReportContext, query: ReportQuery): Promise<CommercialReport> {
    return withTenant(
      this.pool,
      { organizationId: context.organizationId, userId: context.userId },
      async ({ client }) => {
        const zone = await client.query<{ today: string; thirty: string }>(
          `SELECT (now() AT TIME ZONE timezone)::date::text AS today,
                  ((now() AT TIME ZONE timezone)::date - 29)::text AS thirty FROM organization LIMIT 1`,
        );
        const today = zone.rows[0]?.today ?? new Date().toISOString().slice(0, 10);
        const from = query.from ?? zone.rows[0]?.thirty ?? today;
        const to = query.to ?? today;
        const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
        if (Number.isNaN(days) || days < 0 || days > MAX_DAYS) {
          throw new ValidationFailedError([
            {
              path: "to",
              message: `the period must be 0 to ${MAX_DAYS} days and end on or after its start`,
              code: "invalid_value",
            },
          ]);
        }
        // Whole days in the organization's time zone: [from 00:00, day after `to` 00:00).
        const bounds = `(SELECT ($1::date)::timestamp AT TIME ZONE timezone FROM organization LIMIT 1) AS lo,
                        (SELECT (($2::date + 1))::timestamp AT TIME ZONE timezone FROM organization LIMIT 1) AS hi`;

        const spot = await client.query<Row>(
          `WITH b AS (SELECT ${bounds})
           SELECT count(*)::int AS offers,
                  count(*) FILTER (WHERE t.status = 'awarded')::int AS awarded,
                  count(*) FILTER (WHERE t.status = 'cancelled')::int AS cancelled,
                  count(*) FILTER (WHERE t.status = 'open')::int AS still_open,
                  (SELECT count(DISTINCT (x.tender_id, x.carrier_id))::int FROM spot_bid x
                    JOIN spot_tender xt ON xt.id = x.tender_id, b WHERE xt.created_at >= b.lo AND xt.created_at < b.hi) AS bidders
           FROM spot_tender t, b WHERE t.created_at >= b.lo AND t.created_at < b.hi`,
          [from, to],
        );
        const awardedStats = await client.query<Row>(
          `WITH b AS (SELECT ${bounds})
           SELECT avg(w.price_cents)::bigint AS average,
                  count(*) FILTER (WHERE t.target_price_cents IS NOT NULL)::int AS with_target,
                  COALESCE(sum(t.target_price_cents - w.price_cents) FILTER (WHERE t.target_price_cents IS NOT NULL), 0)::bigint AS below_target
           FROM spot_tender t
           JOIN spot_bid w ON w.tender_id = t.id AND w.status = 'awarded', b
           WHERE t.created_at >= b.lo AND t.created_at < b.hi`,
          [from, to],
        );
        const quotes = await client.query<Row>(
          `WITH b AS (SELECT ${bounds})
           SELECT count(*)::int AS created,
                  count(*) FILTER (WHERE q.status IN ('sent', 'accepted', 'rejected'))::int AS sent,
                  count(*) FILTER (WHERE q.status = 'accepted')::int AS accepted,
                  count(*) FILTER (WHERE q.status = 'rejected')::int AS rejected,
                  COALESCE(sum(q.price_cents) FILTER (WHERE q.status = 'accepted'), 0)::bigint AS value,
                  COALESCE(sum(c.contribution_cents) FILTER (WHERE q.status = 'accepted'), 0)::bigint AS contribution
           FROM quote q JOIN calculation c ON c.id = q.calculation_id AND c.organization_id = q.organization_id, b
           WHERE q.created_at >= b.lo AND q.created_at < b.hi`,
          [from, to],
        );
        const deliveries = await client.query<Row>(
          `WITH b AS (SELECT ${bounds}),
                d AS (SELECT e.transport_id, min(e.occurred_at) AS at
                      FROM transport_event e, b
                      WHERE e.to_status = 'delivered' AND e.occurred_at >= b.lo AND e.occurred_at < b.hi
                      GROUP BY e.transport_id)
           SELECT count(*)::int AS delivered,
                  count(w.window_end)::int AS with_window,
                  count(*) FILTER (WHERE w.window_end IS NOT NULL AND d.at <= w.window_end)::int AS on_time
           FROM d LEFT JOIN LATERAL (
             SELECT window_end FROM stop WHERE transport_id = d.transport_id ORDER BY sequence DESC LIMIT 1
           ) w ON true`,
          [from, to],
        );

        const s = spot.rows[0] as Row;
        const a = awardedStats.rows[0] as Row;
        const q = quotes.rows[0] as Row;
        const d = deliveries.rows[0] as Row;
        const offers = Number(s["offers"]);
        const awarded = Number(s["awarded"]);
        const closed = offers - Number(s["still_open"]);
        const accepted = Number(q["accepted"]);
        const rejected = Number(q["rejected"]);
        const value = Number(q["value"]);
        const contribution = Number(q["contribution"]);
        const withWindow = Number(d["with_window"]);
        const onTime = Number(d["on_time"]);
        return {
          period: { from, to },
          note: "Figures come from stored offers, quotes and delivery events only. On-time compares the delivered event with the end of the last delivery window. Nothing is estimated.",
          spot: {
            offers,
            awarded,
            cancelled: Number(s["cancelled"]),
            stillOpen: Number(s["still_open"]),
            awardRateBp: rateBp(awarded, closed),
            bidsPerOffer:
              offers === 0 ? null : Math.round((Number(s["bidders"]) / offers) * 100) / 100,
            averageAwardedPriceCents: a["average"] === null ? null : Number(a["average"]),
            offersWithTarget: Number(a["with_target"]),
            belowTargetCents: Number(a["below_target"]),
          },
          quotes: {
            created: Number(q["created"]),
            sent: Number(q["sent"]),
            accepted,
            rejected,
            acceptanceRateBp: rateBp(accepted, accepted + rejected),
            acceptedValueCents: value,
            acceptedContributionCents: contribution,
            acceptedMarginBp: rateBp(contribution, value),
          },
          deliveries: {
            delivered: Number(d["delivered"]),
            withDeliveryWindow: withWindow,
            onTime,
            onTimeRateBp: rateBp(onTime, withWindow),
          },
        };
      },
    );
  }
}
