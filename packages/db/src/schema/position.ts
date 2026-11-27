import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  pgTable,
  real,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn } from "./columns.ts";
import { driverLink } from "./driver-link.ts";
import { organization } from "./organization.ts";
import { transport } from "./transport.ts";

/**
 * One position a driver's device reported (ADR 0006, ADR 0015). Rows are appended and never changed:
 * the device time (`recorded_at`) and the server time (`received_at`) are kept apart, nothing is
 * interpolated. Rows are removed only by the retention job.
 */
export const positionEvent = pgTable(
  "position_event",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    transportId: uuid("transport_id").notNull(),
    driverLinkId: uuid("driver_link_id").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    /** Horizontal accuracy radius in meters as reported by the device, if it reported one. */
    accuracyM: real("accuracy_m"),
    /** True when the reported accuracy is too coarse to trust for ETA or geofences. */
    lowQuality: boolean("low_quality").notNull().default(false),
    createdAt: createdAtColumn(),
  },
  (t) => [
    foreignKey({
      name: "position_event_transport_org_fk",
      columns: [t.transportId, t.organizationId],
      foreignColumns: [transport.id, transport.organizationId],
    }),
    foreignKey({
      name: "position_event_link_org_fk",
      columns: [t.driverLinkId, t.organizationId],
      foreignColumns: [driverLink.id, driverLink.organizationId],
    }),
    foreignKey({
      name: "position_event_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    check("position_event_latitude_range", sql`${t.latitude} BETWEEN -90 AND 90`),
    check("position_event_longitude_range", sql`${t.longitude} BETWEEN -180 AND 180`),
    check("position_event_accuracy_nonneg", sql`${t.accuracyM} IS NULL OR ${t.accuracyM} >= 0`),
    index("position_event_transport_time_idx").on(t.organizationId, t.transportId, t.recordedAt),
  ],
);

/** The newest position per transport, so lists and maps do not scan the event table. */
export const lastPosition = pgTable(
  "last_position",
  {
    transportId: uuid("transport_id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }).notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    accuracyM: real("accuracy_m"),
    lowQuality: boolean("low_quality").notNull().default(false),
  },
  (t) => [
    unique("last_position_transport_org_key").on(t.transportId, t.organizationId),
    foreignKey({
      name: "last_position_transport_org_fk",
      columns: [t.transportId, t.organizationId],
      foreignColumns: [transport.id, transport.organizationId],
    }),
    foreignKey({
      name: "last_position_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    index("last_position_org_idx").on(t.organizationId, t.recordedAt),
  ],
);
