import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appUser } from "./app-user.ts";
import { createdAtColumn, idColumn, updatedAtColumn } from "./columns.ts";
import { carrier, customer, location } from "./directory.ts";
import { organization } from "./organization.ts";

/** Must equal TRANSPORT_STATUSES in packages/shared (a test in apps/api compares them). */
export const transportStatusEnum = pgEnum("transport_status", [
  "created",
  "planned",
  "assigned",
  "confirmed",
  "loading",
  "in_transit",
  "at_destination",
  "unloading",
  "delivered",
  "completed",
  "cancelled",
]);

export const stopTypeEnum = pgEnum("stop_type", ["pickup", "delivery"]);

/** Where a status change came from. Only `user` exists in Phase 2; the others are reserved for Phase 3 and later. */
export const eventSourceEnum = pgEnum("transport_event_source", [
  "user",
  "driver",
  "integration",
  "system",
]);

/** Last transport number handed out per organization. Locked while a number is taken, so numbers are never reused. */
export const transportCounter = pgTable("transport_counter", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organization.id),
  lastNumber: integer("last_number").notNull().default(0),
});

/**
 * One movement of freight for a customer, with ordered stops. Status changes happen only through the
 * API operation that also writes a transport_event (ADR 0014).
 */
export const transport = pgTable(
  "transport",
  {
    id: idColumn(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    /** Per-organization sequence number, shown as LL-000123. */
    number: integer("number").notNull(),
    status: transportStatusEnum("status").notNull().default("created"),
    customerId: uuid("customer_id").notNull(),
    carrierId: uuid("carrier_id"),
    customerReference: text("customer_reference"),
    purchaseOrder: text("purchase_order"),
    /** Total weight in pounds (US default, ADR 0005). */
    weightLb: numeric("weight_lb", { precision: 12, scale: 2 }),
    pieces: integer("pieces"),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique("transport_id_org_key").on(t.id, t.organizationId),
    unique("transport_org_number_key").on(t.organizationId, t.number),
    foreignKey({
      name: "transport_customer_org_fk",
      columns: [t.customerId, t.organizationId],
      foreignColumns: [customer.id, customer.organizationId],
    }),
    foreignKey({
      name: "transport_carrier_org_fk",
      columns: [t.carrierId, t.organizationId],
      foreignColumns: [carrier.id, carrier.organizationId],
    }),
    check("transport_weight_positive", sql`${t.weightLb} IS NULL OR ${t.weightLb} > 0`),
    check("transport_pieces_positive", sql`${t.pieces} IS NULL OR ${t.pieces} > 0`),
    // Mirrors STATUSES_REQUIRING_CARRIER in packages/shared.
    check(
      "transport_carrier_required",
      sql`${t.carrierId} IS NOT NULL OR ${t.status} IN ('created', 'planned', 'cancelled')`,
    ),
    index("transport_org_status_idx").on(t.organizationId, t.status),
    index("transport_org_created_idx").on(t.organizationId, t.createdAt),
    index("transport_org_customer_idx").on(t.organizationId, t.customerId),
    index("transport_org_carrier_idx").on(t.organizationId, t.carrierId),
  ],
);

/** A pickup or delivery in a transport, in order. The window is read in the time zone of the location. */
export const stop = pgTable(
  "stop",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    transportId: uuid("transport_id").notNull(),
    sequence: integer("sequence").notNull(),
    type: stopTypeEnum("type").notNull(),
    locationId: uuid("location_id").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true, mode: "date" }).notNull(),
    /** Appointment or reference number at the place. */
    reference: text("reference"),
    notes: text("notes"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique("stop_transport_sequence_key").on(t.transportId, t.sequence),
    foreignKey({
      name: "stop_transport_org_fk",
      columns: [t.transportId, t.organizationId],
      foreignColumns: [transport.id, transport.organizationId],
    }),
    foreignKey({
      name: "stop_location_org_fk",
      columns: [t.locationId, t.organizationId],
      foreignColumns: [location.id, location.organizationId],
    }),
    check("stop_sequence_positive", sql`${t.sequence} >= 1`),
    check("stop_window_order", sql`${t.windowEnd} >= ${t.windowStart}`),
    index("stop_org_transport_idx").on(t.organizationId, t.transportId),
    index("stop_org_window_idx").on(t.organizationId, t.windowStart),
  ],
);

/** Immutable history of a transport: every status change, who made it and where it came from. */
export const transportEvent = pgTable(
  "transport_event",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    transportId: uuid("transport_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    source: eventSourceEnum("source").notNull(),
    actorUserId: uuid("actor_user_id").references(() => appUser.id),
    /** Null for the first event, when the transport is created. */
    fromStatus: transportStatusEnum("from_status"),
    toStatus: transportStatusEnum("to_status").notNull(),
    note: text("note"),
  },
  (t) => [
    foreignKey({
      name: "transport_event_transport_org_fk",
      columns: [t.transportId, t.organizationId],
      foreignColumns: [transport.id, transport.organizationId],
    }),
    check("transport_event_user_actor", sql`${t.source} <> 'user' OR ${t.actorUserId} IS NOT NULL`),
    index("transport_event_transport_idx").on(t.organizationId, t.transportId, t.occurredAt),
  ],
);
