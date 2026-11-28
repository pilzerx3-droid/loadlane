import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
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
 * Where an organization wants to be told about events (ADR 0022). The signing secret is stored
 * encrypted (AES-256-GCM with a key from the environment) because the worker needs the plain value
 * to sign each call; it is shown to the person once, when the endpoint is created.
 */
export const webhookEndpoint = pgTable(
  "webhook_endpoint",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    url: text("url").notNull(),
    secretEncrypted: text("secret_encrypted").notNull(),
    events: text("events").array().notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAtColumn(),
    disabledAt: timestamp("disabled_at", { withTimezone: true, mode: "date" }),
    disabledByUserId: uuid("disabled_by_user_id").references(() => appUser.id),
  },
  (t) => [
    unique("webhook_endpoint_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      name: "webhook_endpoint_organization_fk",
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }),
    check("webhook_endpoint_url_length", sql`char_length(${t.url}) BETWEEN 8 AND 500`),
    check("webhook_endpoint_has_event", sql`cardinality(${t.events}) >= 1`),
    check(
      "webhook_endpoint_disabled_consistent",
      sql`(${t.disabledAt} IS NULL) = (${t.disabledByUserId} IS NULL)`,
    ),
  ],
);

/**
 * One event for one endpoint, written in the same transaction as the event itself (a trigger on
 * transport_event), so nothing is lost if the process stops. The worker delivers it with retries.
 * The payload is fixed when the event happens and never contains prices, drivers or positions.
 */
export const webhookDelivery = pgTable(
  "webhook_delivery",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").notNull(),
    endpointId: uuid("endpoint_id").notNull(),
    eventId: uuid("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lastStatusCode: integer("last_status_code"),
    lastErrorCode: text("last_error_code"),
    createdAt: createdAtColumn(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    unique("webhook_delivery_endpoint_event_key").on(t.endpointId, t.eventId),
    foreignKey({
      name: "webhook_delivery_endpoint_org_fk",
      columns: [t.endpointId, t.organizationId],
      foreignColumns: [webhookEndpoint.id, webhookEndpoint.organizationId],
    }),
    check("webhook_delivery_status", sql`${t.status} IN ('pending', 'delivered', 'failed')`),
    index("webhook_delivery_due_idx").on(t.organizationId, t.status, t.nextAttemptAt),
  ],
);
