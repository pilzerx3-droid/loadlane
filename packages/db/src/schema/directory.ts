import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, updatedAtColumn } from "./columns.ts";
import { organization } from "./organization.ts";

const archivedAtColumn = () => timestamp("archived_at", { withTimezone: true, mode: "date" });

/**
 * Companies a shipper sells to or ships for. Archived, never deleted, so that old transports keep
 * their customer. The (id, organization_id) key is the target of composite foreign keys in later tables.
 */
export const customer = pgTable(
  "customer",
  {
    id: idColumn(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    notes: text("notes"),
    archivedAt: archivedAtColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique("customer_id_org_key").on(t.id, t.organizationId),
    uniqueIndex("customer_active_name_key")
      .on(t.organizationId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    index("customer_org_name_idx").on(t.organizationId, t.name),
  ],
);

/**
 * Carriers the organization works with. In Phase 2 a carrier is a record inside the organization;
 * linking it to a carrier's own Loadlane organization comes with Spot Freight. MC and DOT numbers are
 * stored as typed in and are not verified against any registry.
 */
export const carrier = pgTable(
  "carrier",
  {
    id: idColumn(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    name: text("name").notNull(),
    mcNumber: text("mc_number"),
    dotNumber: text("dot_number"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    notes: text("notes"),
    archivedAt: archivedAtColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique("carrier_id_org_key").on(t.id, t.organizationId),
    uniqueIndex("carrier_active_name_key")
      .on(t.organizationId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    index("carrier_org_name_idx").on(t.organizationId, t.name),
  ],
);

/**
 * A place where freight is picked up or delivered. The time zone is the place's own: appointment
 * windows are interpreted in it. There are no coordinates yet; they come with geocoding and are never guessed.
 */
export const location = pgTable(
  "location",
  {
    id: idColumn(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    name: text("name").notNull(),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    /** Two-letter US state or territory code. */
    state: text("state").notNull(),
    postalCode: text("postal_code").notNull(),
    country: text("country").notNull().default("US"),
    /** IANA time zone of the place, for example America/Denver. */
    timezone: text("timezone").notNull(),
    notes: text("notes"),
    archivedAt: archivedAtColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique("location_id_org_key").on(t.id, t.organizationId),
    index("location_org_name_idx").on(t.organizationId, t.name),
  ],
);
