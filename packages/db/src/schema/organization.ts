import { sql } from "drizzle-orm";
import { char, check, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, updatedAtColumn } from "./columns.ts";

export const organizationRegionEnum = pgEnum("organization_region", ["us", "eu"]);
export const distanceUnitEnum = pgEnum("distance_unit", ["mi", "km"]);
export const weightUnitEnum = pgEnum("weight_unit", ["lb", "kg"]);

/**
 * A tenant. Defaults follow ADR 0005 (US first); the region field lets EU hosting be added
 * later without a data model change. The timezone has no default on purpose: it must be
 * chosen explicitly for every organization.
 */
export const organization = pgTable(
  "organization",
  {
    id: idColumn(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    region: organizationRegionEnum("region").notNull().default("us"),
    distanceUnit: distanceUnitEnum("distance_unit").notNull().default("mi"),
    weightUnit: weightUnitEnum("weight_unit").notNull().default("lb"),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    locale: text("locale").notNull().default("en-US"),
    timezone: text("timezone").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("organization_slug_key").on(t.slug),
    check("organization_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("organization_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);
