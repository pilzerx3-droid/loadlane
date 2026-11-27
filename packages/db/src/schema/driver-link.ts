import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
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
 * A capability link that lets a driver work on exactly one transport without an account (ADR 0015).
 * Only the SHA-256 hash of the secret token is stored, never the token itself.
 */
export const driverLink = pgTable(
  "driver_link",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    transportId: uuid("transport_id").notNull(),
    /** Lowercase hex SHA-256 of the token in the URL. */
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
    unique("driver_link_id_org_key").on(t.id, t.organizationId),
    unique("driver_link_token_hash_key").on(t.tokenHash),
    foreignKey({
      name: "driver_link_transport_org_fk",
      columns: [t.transportId, t.organizationId],
      foreignColumns: [transport.id, transport.organizationId],
    }),
    foreignKey({
      name: "driver_link_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    check("driver_link_hash_format", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "driver_link_revoked_consistent",
      sql`(${t.revokedAt} IS NULL) = (${t.revokedByUserId} IS NULL)`,
    ),
    index("driver_link_org_transport_idx").on(t.organizationId, t.transportId, t.createdAt),
  ],
);

/**
 * The driver's recorded consent to share a position through one link. Without a row that is
 * accepted and not withdrawn, the API refuses positions (`consent_required`).
 */
export const driverConsent = pgTable(
  "driver_consent",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    driverLinkId: uuid("driver_link_id").notNull(),
    /** Version of the consent text the driver saw, so changed wording can be traced. */
    textVersion: integer("text_version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    foreignKey({
      name: "driver_consent_link_org_fk",
      columns: [t.driverLinkId, t.organizationId],
      foreignColumns: [driverLink.id, driverLink.organizationId],
    }),
    check(
      "driver_consent_withdrawn_after",
      sql`${t.withdrawnAt} IS NULL OR ${t.withdrawnAt} >= ${t.acceptedAt}`,
    ),
    index("driver_consent_link_idx").on(t.organizationId, t.driverLinkId, t.acceptedAt),
  ],
);
