import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appUser } from "./app-user.ts";
import { createdAtColumn, idColumn } from "./columns.ts";
import { customer } from "./directory.ts";
import { organization } from "./organization.ts";

/**
 * A freight calculation, frozen when it was computed (ADR 0007). The input and the full result are
 * kept as JSON so the calculation can be reproduced and audited; the headline figures are also
 * stored as columns. Markup, margin and contribution are separate columns and are never converted
 * into each other. Rows are never updated: a changed calculation is a new row.
 */
export const calculation = pgTable(
  "calculation",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    customerId: uuid("customer_id"),
    name: text("name").notNull(),
    /** Version of the calculation rules that produced the result. */
    engineVersion: integer("engine_version").notNull(),
    /** markup, margin, contribution or price: how the price was set, as chosen. */
    pricingMode: text("pricing_mode").notNull(),
    input: jsonb("input").notNull(),
    result: jsonb("result").notNull(),
    costCents: bigint("cost_cents", { mode: "number" }).notNull(),
    priceCents: bigint("price_cents", { mode: "number" }).notNull(),
    /** price - cost, in cents. May be negative. */
    contributionCents: bigint("contribution_cents", { mode: "number" }).notNull(),
    /** contribution / cost in basis points, null when the cost is zero. */
    markupBp: integer("markup_bp"),
    /** contribution / price in basis points, null when the price is zero. */
    marginBp: integer("margin_bp"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique("calculation_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      name: "calculation_customer_org_fk",
      columns: [t.customerId, t.organizationId],
      foreignColumns: [customer.id, customer.organizationId],
    }),
    foreignKey({
      name: "calculation_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    check("calculation_amounts_nonnegative", sql`${t.costCents} >= 0 AND ${t.priceCents} >= 0`),
    check(
      "calculation_contribution_consistent",
      sql`${t.contributionCents} = ${t.priceCents} - ${t.costCents}`,
    ),
    check(
      "calculation_pricing_mode",
      sql`${t.pricingMode} IN ('markup', 'margin', 'contribution', 'price')`,
    ),
    index("calculation_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);
