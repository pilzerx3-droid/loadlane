import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./organization.ts";
import { transport } from "./transport.ts";

/**
 * The newest estimated arrival per transport (ADR 0021). It is derived data: a routing provider
 * answered how long it takes to drive from the last reported position to the final delivery stop.
 * It records which position it was based on and when it was calculated, so it can always be shown
 * with its age and source. It carries no traffic, rest-break or dwell time.
 */
export const etaEstimate = pgTable(
  "eta_estimate",
  {
    transportId: uuid("transport_id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true, mode: "date" }).notNull(),
    /** The device time of the position the estimate starts from. */
    basedOnRecordedAt: timestamp("based_on_recorded_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    fromLatitude: doublePrecision("from_latitude").notNull(),
    fromLongitude: doublePrecision("from_longitude").notNull(),
    distanceM: integer("distance_m").notNull(),
    durationS: integer("duration_s").notNull(),
    /** basedOnRecordedAt plus durationS: when the truck arrives if it keeps driving. */
    etaAt: timestamp("eta_at", { withTimezone: true, mode: "date" }).notNull(),
    provider: text("provider").notNull(),
  },
  (t) => [
    foreignKey({
      name: "eta_estimate_transport_org_fk",
      columns: [t.transportId, t.organizationId],
      foreignColumns: [transport.id, transport.organizationId],
    }),
    foreignKey({
      name: "eta_estimate_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    check("eta_estimate_nonnegative", sql`${t.distanceM} >= 0 AND ${t.durationS} >= 0`),
    check("eta_estimate_provider", sql`${t.provider} IN ('openrouteservice')`),
  ],
);
