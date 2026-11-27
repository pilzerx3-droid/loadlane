import {
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appUser } from "./app-user.ts";
import { createdAtColumn, idColumn, updatedAtColumn } from "./columns.ts";
import { organization } from "./organization.ts";
import { role } from "./role.ts";

export const membershipStatusEnum = pgEnum("membership_status", [
  "invited",
  "active",
  "suspended",
  "removed",
]);

/** A person's membership in one organization. Members are never deleted, only set to removed. */
export const membership = pgTable(
  "membership",
  {
    id: idColumn(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id),
    status: membershipStatusEnum("status").notNull().default("invited"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique("membership_org_user_key").on(t.organizationId, t.userId),
    // Target of the composite foreign key in membership_role.
    unique("membership_id_org_key").on(t.id, t.organizationId),
    index("membership_user_idx").on(t.userId),
  ],
);

/** The roles a member holds. A member can hold several roles at once (for example dispatcher and sales). */
export const membershipRole = pgTable(
  "membership_role",
  {
    organizationId: uuid("organization_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    roleKey: text("role_key")
      .notNull()
      .references(() => role.key),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.membershipId, t.roleKey] }),
    // The composite key guarantees that a role assignment and its membership belong to the same organization.
    foreignKey({
      name: "membership_role_membership_org_fk",
      columns: [t.membershipId, t.organizationId],
      foreignColumns: [membership.id, membership.organizationId],
    }).onDelete("cascade"),
    index("membership_role_org_idx").on(t.organizationId),
  ],
);
