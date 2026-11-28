import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appUser } from "./app-user.ts";
import { createdAtColumn, idColumn } from "./columns.ts";
import { carrier } from "./directory.ts";
import { organization } from "./organization.ts";
import { transport } from "./transport.ts";

export const spotTenderStatusEnum = pgEnum("spot_tender_status", [
  "open",
  "awarded",
  "cancelled",
  "closed",
]);

export const spotBidStatusEnum = pgEnum("spot_bid_status", [
  "submitted",
  "superseded",
  "withdrawn",
  "rejected",
  "awarded",
]);

/**
 * An offer of one transport to selected carriers (ADR 0019). Nothing is copied: the transport
 * keeps its stops and references. Awarding sets the carrier on that transport.
 */
export const spotTender = pgTable(
  "spot_tender",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    transportId: uuid("transport_id").notNull(),
    status: spotTenderStatusEnum("status").notNull().default("open"),
    responseDeadline: timestamp("response_deadline", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    /** The shipper's own target price in cents. Internal: never shown to carriers. */
    targetPriceCents: bigint("target_price_cents", { mode: "number" }),
    notes: text("notes"),
    awardedAt: timestamp("awarded_at", { withTimezone: true, mode: "date" }),
    awardedByUserId: uuid("awarded_by_user_id").references(() => appUser.id),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique("spot_tender_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      name: "spot_tender_transport_org_fk",
      columns: [t.transportId, t.organizationId],
      foreignColumns: [transport.id, transport.organizationId],
    }),
    foreignKey({
      name: "spot_tender_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    uniqueIndex("spot_tender_one_open_per_transport")
      .on(t.transportId)
      .where(sql`${t.status} = 'open'`),
    check(
      "spot_tender_target_nonnegative",
      sql`${t.targetPriceCents} IS NULL OR ${t.targetPriceCents} >= 0`,
    ),
    check(
      "spot_tender_award_consistent",
      sql`(${t.status} = 'awarded') = (${t.awardedAt} IS NOT NULL AND ${t.awardedByUserId} IS NOT NULL)`,
    ),
    index("spot_tender_org_status_idx").on(t.organizationId, t.status, t.createdAt),
  ],
);

/** The invitation of one carrier to one tender. The carrier gets a capability link; only its hash is stored. */
export const spotInvitation = pgTable(
  "spot_invitation",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    tenderId: uuid("tender_id").notNull(),
    carrierId: uuid("carrier_id").notNull(),
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
    unique("spot_invitation_id_org_key").on(t.id, t.organizationId),
    unique("spot_invitation_token_hash_key").on(t.tokenHash),
    unique("spot_invitation_tender_carrier_key").on(t.tenderId, t.carrierId),
    foreignKey({
      name: "spot_invitation_tender_org_fk",
      columns: [t.tenderId, t.organizationId],
      foreignColumns: [spotTender.id, spotTender.organizationId],
    }),
    foreignKey({
      name: "spot_invitation_carrier_org_fk",
      columns: [t.carrierId, t.organizationId],
      foreignColumns: [carrier.id, carrier.organizationId],
    }),
    foreignKey({
      name: "spot_invitation_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    check("spot_invitation_hash_format", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "spot_invitation_revoked_consistent",
      sql`(${t.revokedAt} IS NULL) = (${t.revokedByUserId} IS NULL)`,
    ),
  ],
);

/** One price offered for a tender. A new submission supersedes the earlier one; nothing is deleted. */
export const spotBid = pgTable(
  "spot_bid",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    tenderId: uuid("tender_id").notNull(),
    carrierId: uuid("carrier_id").notNull(),
    invitationId: uuid("invitation_id"),
    priceCents: bigint("price_cents", { mode: "number" }).notNull(),
    /** Free text from the carrier, for example when the truck can load. */
    note: text("note"),
    status: spotBidStatusEnum("status").notNull().default("submitted"),
    /** Set when staff entered the bid for the carrier (phone, e-mail). Null for bids sent through the link. */
    enteredByUserId: uuid("entered_by_user_id").references(() => appUser.id),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique("spot_bid_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      name: "spot_bid_tender_org_fk",
      columns: [t.tenderId, t.organizationId],
      foreignColumns: [spotTender.id, spotTender.organizationId],
    }),
    foreignKey({
      name: "spot_bid_carrier_org_fk",
      columns: [t.carrierId, t.organizationId],
      foreignColumns: [carrier.id, carrier.organizationId],
    }),
    foreignKey({
      name: "spot_bid_invitation_org_fk",
      columns: [t.invitationId, t.organizationId],
      foreignColumns: [spotInvitation.id, spotInvitation.organizationId],
    }),
    foreignKey({
      name: "spot_bid_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    check("spot_bid_price_positive", sql`${t.priceCents} > 0`),
    check(
      "spot_bid_source_consistent",
      sql`(${t.invitationId} IS NULL) = (${t.enteredByUserId} IS NOT NULL)`,
    ),
    uniqueIndex("spot_bid_one_live_per_carrier")
      .on(t.tenderId, t.carrierId)
      .where(sql`${t.status} IN ('submitted', 'awarded')`),
    uniqueIndex("spot_bid_one_awarded_per_tender")
      .on(t.tenderId)
      .where(sql`${t.status} = 'awarded'`),
    index("spot_bid_tender_idx").on(t.organizationId, t.tenderId, t.createdAt),
  ],
);
