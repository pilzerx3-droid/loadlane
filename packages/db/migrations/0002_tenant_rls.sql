-- Migration 0002: application role, table privileges and tenant isolation (ADR 0002).
--
-- Model:
--   * The migration owner (the role that runs this file) owns all tables and is NOT used by the
--     application. Every table has FORCE ROW LEVEL SECURITY and its policies are granted TO
--     loadlane_app only, so a non-superuser owner sees nothing by default. A superuser (the local
--     Docker owner is one) bypasses RLS regardless, which is why the application never uses the owner.
--   * The application connects as loadlane_app and sets the tenant per transaction with
--     set_config('app.organization_id', ..., true), see packages/db/src/tenant.ts. Without a
--     tenant every tenant table returns zero rows and rejects writes.
--   * New tables must enable and force RLS, add policies and grant privileges in their own
--     migration. rls.test.ts fails when a table in schema public forgets RLS.

-- The login role (with a password) is created by infra/postgres/init in local development.
-- Elsewhere the role is created here without login; whoever operates the database gives it a login.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'loadlane_app') THEN
		CREATE ROLE loadlane_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
	END IF;
EXCEPTION
	WHEN duplicate_object THEN NULL; -- created concurrently by another migration run
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO loadlane_app;--> statement-breakpoint

-- Tenant context set by withTenant(). Empty or unset means "no tenant".
CREATE FUNCTION app_organization_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
	SELECT nullif(current_setting('app.organization_id', true), '')::uuid
$$;--> statement-breakpoint
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
	SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;--> statement-breakpoint

-- Privileges. DELETE is granted only where rows are really deleted (membership_role).
-- Rows of organization, app_user and membership are deactivated, never deleted; audit_log is append-only.
GRANT SELECT, INSERT, UPDATE ON "organization" TO loadlane_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "app_user" TO loadlane_app;--> statement-breakpoint
GRANT SELECT ON "role" TO loadlane_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "membership" TO loadlane_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "membership_role" TO loadlane_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "audit_log" TO loadlane_app;--> statement-breakpoint

-- organization: visible when it is the current tenant, or when the current user is an active member
-- (needed for the organization switcher before a tenant is chosen). A new organization can only be
-- created as the current tenant, so the creator sets the tenant to the new id first.
ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY organization_select ON "organization" FOR SELECT TO loadlane_app USING (
	id = app_organization_id()
	OR EXISTS (
		SELECT 1 FROM "membership" m
		WHERE m.organization_id = "organization".id
			AND m.user_id = app_user_id()
			AND m.status = 'active'
	)
);--> statement-breakpoint
CREATE POLICY organization_insert ON "organization" FOR INSERT TO loadlane_app
	WITH CHECK (id = app_organization_id());--> statement-breakpoint
CREATE POLICY organization_update ON "organization" FOR UPDATE TO loadlane_app
	USING (id = app_organization_id()) WITH CHECK (id = app_organization_id());--> statement-breakpoint

-- app_user: a person is not owned by an organization. Visible to themselves and to members of the
-- current tenant; a person can only register or change their own row.
ALTER TABLE "app_user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_user" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY app_user_select ON "app_user" FOR SELECT TO loadlane_app USING (
	id = app_user_id()
	OR EXISTS (
		SELECT 1 FROM "membership" m
		WHERE m.user_id = "app_user".id AND m.organization_id = app_organization_id()
	)
);--> statement-breakpoint
CREATE POLICY app_user_insert ON "app_user" FOR INSERT TO loadlane_app
	WITH CHECK (id = app_user_id());--> statement-breakpoint
CREATE POLICY app_user_update ON "app_user" FOR UPDATE TO loadlane_app
	USING (id = app_user_id()) WITH CHECK (id = app_user_id());--> statement-breakpoint

-- membership: a tenant sees its own members; a person additionally sees their own memberships in
-- every organization (organization switcher). Writes only inside the current tenant.
ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY membership_select ON "membership" FOR SELECT TO loadlane_app
	USING (organization_id = app_organization_id() OR user_id = app_user_id());--> statement-breakpoint
CREATE POLICY membership_insert ON "membership" FOR INSERT TO loadlane_app
	WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY membership_update ON "membership" FOR UPDATE TO loadlane_app
	USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint

-- membership_role: strictly tenant scoped.
ALTER TABLE "membership_role" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership_role" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY membership_role_select ON "membership_role" FOR SELECT TO loadlane_app
	USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY membership_role_insert ON "membership_role" FOR INSERT TO loadlane_app
	WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY membership_role_delete ON "membership_role" FOR DELETE TO loadlane_app
	USING (organization_id = app_organization_id());--> statement-breakpoint

-- audit_log: strictly tenant scoped, insert and read only (no update or delete privilege, plus triggers).
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY audit_log_select ON "audit_log" FOR SELECT TO loadlane_app
	USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY audit_log_insert ON "audit_log" FOR INSERT TO loadlane_app
	WITH CHECK (organization_id = app_organization_id());
