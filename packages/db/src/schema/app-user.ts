import { sql } from "drizzle-orm";
import { check, customType, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, updatedAtColumn } from "./columns.ts";

/** Case-insensitive text (PostgreSQL citext extension, enabled in migration 0001). */
const citext = customType<{ data: string }>({
  dataType: () => "citext",
});

/**
 * A person. Not owned by an organization: one person can be a member of several, see
 * `membership`. The table is called app_user because `user` is a reserved word in PostgreSQL.
 * auth_issuer and auth_subject identify the person at the OIDC provider and stay empty until
 * the login integration (P1-06).
 */
export const appUser = pgTable(
  "app_user",
  {
    id: idColumn(),
    email: citext("email").notNull(),
    displayName: text("display_name").notNull(),
    authIssuer: text("auth_issuer"),
    authSubject: text("auth_subject"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("app_user_email_key").on(t.email),
    uniqueIndex("app_user_auth_identity_key").on(t.authIssuer, t.authSubject),
    check(
      "app_user_auth_identity_pair",
      sql`(${t.authIssuer} IS NULL) = (${t.authSubject} IS NULL)`,
    ),
  ],
);
