import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appUser } from "./app-user.ts";
import { createdAtColumn, idColumn } from "./columns.ts";
import { organization } from "./organization.ts";
import { transport } from "./transport.ts";

/**
 * A capability link for the shipper's customer to follow one transport without an account
 * (ADR 0017). Only the SHA-256 hash of the token is stored. The page behind it shows released
 * fields only and never a driver's position.
 */
export const trackingLink = pgTable(
  "tracking_link",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    transportId: uuid("transport_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => appUser.id),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique("tracking_link_token_hash_key").on(t.tokenHash),
    foreignKey({
      name: "tracking_link_transport_org_fk",
      columns: [t.transportId, t.organizationId],
      foreignColumns: [transport.id, transport.organizationId],
    }),
    foreignKey({
      name: "tracking_link_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    check("tracking_link_hash_format", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "tracking_link_revoked_consistent",
      sql`(${t.revokedAt} IS NULL) = (${t.revokedByUserId} IS NULL)`,
    ),
    index("tracking_link_org_transport_idx").on(t.organizationId, t.transportId, t.createdAt),
  ],
);
