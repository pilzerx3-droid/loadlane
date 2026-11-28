import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appUser } from "./app-user.ts";
import { calculation } from "./calculation.ts";
import { createdAtColumn, idColumn } from "./columns.ts";
import { customer } from "./directory.ts";
import { organization } from "./organization.ts";

export const quoteStatusEnum = pgEnum("quote_status", [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "cancelled",
]);

/** Last quote number handed out per organization, locked while a number is taken. */
export const quoteCounter = pgTable("quote_counter", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organization.id),
  lastNumber: integer("last_number").notNull().default(0),
});

/**
 * A quote offers the customer the price of one frozen calculation. The price is copied from the
 * calculation when the quote is created and never changes with it. Internal cost and margin stay
 * in the calculation; the quote carries only what the customer is offered.
 */
export const quote = pgTable(
  "quote",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    /** Per-organization sequence, shown as QT-000123. */
    number: integer("number").notNull(),
    calculationId: uuid("calculation_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    status: quoteStatusEnum("status").notNull().default("draft"),
    priceCents: bigint("price_cents", { mode: "number" }).notNull(),
    /** Last day the offer is valid (inclusive). */
    validUntil: date("valid_until", { mode: "string" }).notNull(),
    terms: text("terms"),
    notes: text("notes"),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique("quote_id_org_key").on(t.id, t.organizationId),
    unique("quote_org_number_key").on(t.organizationId, t.number),
    foreignKey({
      name: "quote_calculation_org_fk",
      columns: [t.calculationId, t.organizationId],
      foreignColumns: [calculation.id, calculation.organizationId],
    }),
    foreignKey({
      name: "quote_customer_org_fk",
      columns: [t.customerId, t.organizationId],
      foreignColumns: [customer.id, customer.organizationId],
    }),
    foreignKey({
      name: "quote_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    check("quote_price_nonnegative", sql`${t.priceCents} >= 0`),
    check(
      "quote_sent_consistent",
      sql`(${t.status} IN ('draft', 'cancelled')) OR ${t.sentAt} IS NOT NULL`,
    ),
    check(
      "quote_decided_consistent",
      sql`(${t.status} IN ('accepted', 'rejected')) = (${t.decidedAt} IS NOT NULL)`,
    ),
    index("quote_org_status_idx").on(t.organizationId, t.status, t.createdAt),
  ],
);
