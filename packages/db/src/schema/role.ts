import { pgTable, text } from "drizzle-orm/pg-core";

/**
 * Fixed catalog of roles, seeded by migration 0001 and read-only for the application.
 * It holds no customer data, so it has no organization_id and no row-level security.
 * What each role may do is defined in code (P1-07), not in the database.
 */
export const role = pgTable("role", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
});
