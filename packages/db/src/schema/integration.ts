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

/**
 * A key for another system (ERP, TMS, middleware) to call the integration API of one organization
 * (ADR 0009). Only the SHA-256 hash of the key is stored; the key is shown once. A key acts for the
 * organization, never for a person, and can do only what its scopes list.
 */
export const apiKey = pgTable(
  "api_key",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    name: text("name").notNull(),
    /** The first characters of the key, to recognize it in lists. Not secret. */
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes").array().notNull(),
    /** The person who created the key: transports made through it are recorded as owned by them. */
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAtColumn(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => appUser.id),
  },
  (t) => [
    unique("api_key_id_org_key").on(t.id, t.organizationId),
    unique("api_key_hash_key").on(t.keyHash),
    foreignKey({
      name: "api_key_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    check("api_key_hash_format", sql`${t.keyHash} ~ '^[0-9a-f]{64}$'`),
    check("api_key_has_scope", sql`cardinality(${t.scopes}) >= 1`),
    check(
      "api_key_revoked_consistent",
      sql`(${t.revokedAt} IS NULL) = (${t.revokedByUserId} IS NULL)`,
    ),
    index("api_key_org_idx").on(t.organizationId, t.createdAt),
  ],
);

/**
 * Remembers which record an external system's object became, so sending the same object again does
 * not create a duplicate (idempotency). `request_hash` tells a harmless repeat from a changed payload.
 */
export const externalRef = pgTable(
  "external_ref",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    apiKeyId: uuid("api_key_id").notNull(),
    entityType: text("entity_type").notNull(),
    externalId: text("external_id").notNull(),
    internalId: uuid("internal_id").notNull(),
    requestHash: text("request_hash").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique("external_ref_unique_key").on(t.organizationId, t.entityType, t.externalId),
    foreignKey({
      name: "external_ref_api_key_org_fk",
      columns: [t.apiKeyId, t.organizationId],
      foreignColumns: [apiKey.id, apiKey.organizationId],
    }),
    foreignKey({
      name: "external_ref_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    check("external_ref_entity_type", sql`${t.entityType} IN ('transport')`),
    check("external_ref_external_id_length", sql`char_length(${t.externalId}) BETWEEN 1 AND 200`),
  ],
);
