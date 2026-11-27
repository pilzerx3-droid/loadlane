-- Migration 0003: sign-in identity (ADR 0003). At sign-in the API knows only the verified token's
-- issuer and subject, not our user id. This migration lets it find that one person and register a new
-- one, and stops the application from rewriting identity columns later.
--
-- The identity is a transaction-local context like the tenant (see withTenant in packages/db):
-- set_config('app.auth_issuer', ...) and set_config('app.auth_subject', ...). The API sets it only
-- from a token it has verified.

CREATE FUNCTION app_auth_issuer() RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
	SELECT nullif(current_setting('app.auth_issuer', true), '')
$$;--> statement-breakpoint
CREATE FUNCTION app_auth_subject() RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
	SELECT nullif(current_setting('app.auth_subject', true), '')
$$;--> statement-breakpoint

-- Exactly the one person whose identity is set in the context becomes visible. A missing or partial
-- identity matches nothing (comparisons with NULL are never true).
CREATE POLICY app_user_select_identity ON "app_user" FOR SELECT TO loadlane_app
	USING (auth_issuer = app_auth_issuer() AND auth_subject = app_auth_subject());--> statement-breakpoint

-- Registering: the new row must carry exactly the identity set in the context (or none, when the
-- context has none), in addition to being the person's own id.
DROP POLICY app_user_insert ON "app_user";--> statement-breakpoint
CREATE POLICY app_user_insert ON "app_user" FOR INSERT TO loadlane_app WITH CHECK (
	id = app_user_id()
	AND auth_issuer IS NOT DISTINCT FROM app_auth_issuer()
	AND auth_subject IS NOT DISTINCT FROM app_auth_subject()
);--> statement-breakpoint

-- The application may change the display name only. Identity and e-mail changes need their own
-- flows (verification, account linking) and their own migration.
REVOKE UPDATE ON "app_user" FROM loadlane_app;--> statement-breakpoint
GRANT UPDATE (display_name) ON "app_user" TO loadlane_app;
