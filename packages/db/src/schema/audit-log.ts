import { sql } from "drizzle-orm";
import {
  check,
  index,
  inet,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { appUser } from "./app-user.ts";
import { idColumn } from "./columns.ts";
import { organization } from "./organization.ts";

export const auditActorTypeEnum = pgEnum("audit_actor_type", ["user", "system", "api_key"]);

/**
 * Append-only record of who did what. Updates, deletes and truncates are rejected by triggers
 * (migration 0001).
 *
 * OPEN (legal): ip and user_agent are personal data under several US state laws. They are stored
 * to investigate security incidents, but the retention period has not been decided. Clarify it with
 * a privacy attorney before the first production launch (see docs/adr/0002 and docs/us-market-notes.md).
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: idColumn(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    actorType: auditActorTypeEnum("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => appUser.id),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    /** Before and after values of the change. Never store secrets or tokens here. */
    changes: jsonb("changes"),
    requestId: text("request_id"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("audit_log_org_time_idx").on(t.organizationId, t.occurredAt),
    index("audit_log_org_entity_idx").on(t.organizationId, t.entityType, t.entityId),
    check("audit_log_user_actor", sql`${t.actorType} <> 'user' OR ${t.actorUserId} IS NOT NULL`),
  ],
);
