import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appUser } from "./app-user.ts";
import { createdAtColumn, idColumn } from "./columns.ts";
import { carrier, customer } from "./directory.ts";
import { organization } from "./organization.ts";

export const tariffKindEnum = pgEnum("tariff_kind", ["sell", "buy"]);

/**
 * A price list. `sell` lists belong to a customer (what we charge), `buy` lists to a carrier (what
 * we pay). The rates themselves live in immutable versions (ADR 0007).
 */
export const tariff = pgTable(
  "tariff",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    name: text("name").notNull(),
    kind: tariffKindEnum("kind").notNull(),
    customerId: uuid("customer_id"),
    carrierId: uuid("carrier_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique("tariff_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      name: "tariff_customer_org_fk",
      columns: [t.customerId, t.organizationId],
      foreignColumns: [customer.id, customer.organizationId],
    }),
    foreignKey({
      name: "tariff_carrier_org_fk",
      columns: [t.carrierId, t.organizationId],
      foreignColumns: [carrier.id, carrier.organizationId],
    }),
    foreignKey({
      name: "tariff_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    check(
      "tariff_party_matches_kind",
      sql`(${t.kind} = 'sell' AND ${t.carrierId} IS NULL) OR (${t.kind} = 'buy' AND ${t.customerId} IS NULL)`,
    ),
    index("tariff_org_idx").on(t.organizationId, t.createdAt),
  ],
);

/** One version of a price list: valid from a date, never changed afterwards. A change is a new version. */
export const tariffVersion = pgTable(
  "tariff_version",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    tariffId: uuid("tariff_id").notNull(),
    version: integer("version").notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    note: text("note"),
    /** The rate lines: kind, label, unit, rate in cents and an optional minimum charge in cents. */
    lines: jsonb("lines").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique("tariff_version_id_org_key").on(t.id, t.organizationId),
    unique("tariff_version_number_key").on(t.tariffId, t.version),
    unique("tariff_version_valid_from_key").on(t.tariffId, t.validFrom),
    foreignKey({
      name: "tariff_version_tariff_org_fk",
      columns: [t.tariffId, t.organizationId],
      foreignColumns: [tariff.id, tariff.organizationId],
    }),
    foreignKey({
      name: "tariff_version_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    check("tariff_version_positive", sql`${t.version} >= 1`),
    check("tariff_version_lines_array", sql`jsonb_typeof(${t.lines}) = 'array'`),
  ],
);
