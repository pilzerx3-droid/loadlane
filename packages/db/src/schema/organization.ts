import { sql } from "drizzle-orm";
import {
  char,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appUser } from "./app-user.ts";
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
    /**
     * Days after a transport is finished (delivered, completed or cancelled) before its driver
     * positions are deleted (ADR 0015). 30 until the product owner confirms the legal period.
     */
    positionRetentionDays: integer("position_retention_days").notNull().default(30),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    /** Who created the organization through the API. Empty for organizations created in other ways. Used to limit self-service creation. */
    createdByUserId: uuid("created_by_user_id").references(() => appUser.id),
  },
  (t) => [
    uniqueIndex("organization_slug_key").on(t.slug),
    index("organization_created_by_idx").on(t.createdByUserId),
    check("organization_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("organization_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "organization_position_retention_range",
      sql`${t.positionRetentionDays} BETWEEN 1 AND 3650`,
    ),
  ],
);
