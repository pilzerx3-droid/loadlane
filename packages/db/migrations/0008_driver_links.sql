CREATE TABLE "driver_consent" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"driver_link_id" uuid NOT NULL,
	"text_version" integer NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "driver_consent_withdrawn_after" CHECK ("driver_consent"."withdrawn_at" IS NULL OR "driver_consent"."withdrawn_at" >= "driver_consent"."accepted_at")
);
--> statement-breakpoint
CREATE TABLE "driver_link" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"transport_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_link_id_org_key" UNIQUE("id","organization_id"),
	CONSTRAINT "driver_link_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "driver_link_hash_format" CHECK ("driver_link"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "driver_link_revoked_consistent" CHECK (("driver_link"."revoked_at" IS NULL) = ("driver_link"."revoked_by_user_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "driver_consent" ADD CONSTRAINT "driver_consent_link_org_fk" FOREIGN KEY ("driver_link_id","organization_id") REFERENCES "public"."driver_link"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_link" ADD CONSTRAINT "driver_link_revoked_by_user_id_app_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_link" ADD CONSTRAINT "driver_link_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_link" ADD CONSTRAINT "driver_link_transport_org_fk" FOREIGN KEY ("transport_id","organization_id") REFERENCES "public"."transport"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_link" ADD CONSTRAINT "driver_link_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_consent_link_idx" ON "driver_consent" USING btree ("organization_id","driver_link_id","accepted_at");--> statement-breakpoint
CREATE INDEX "driver_link_org_transport_idx" ON "driver_link" USING btree ("organization_id","transport_id","created_at");--> statement-breakpoint

-- Hand-written addition: privileges and tenant isolation (ADR 0002, ADR 0015).
-- A driver link is revoked by setting revoked_at, never deleted; consent is withdrawn the same way.
CREATE FUNCTION app_driver_token_hash() RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
	SELECT nullif(current_setting('app.driver_token_hash', true), '')
$$;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "driver_link" TO loadlane_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "driver_consent" TO loadlane_app;--> statement-breakpoint
-- Only the revocation columns may change on a link; the token, transport and expiry are fixed.
REVOKE UPDATE ON "driver_link" FROM loadlane_app;--> statement-breakpoint
GRANT UPDATE (revoked_at, revoked_by_user_id) ON "driver_link" TO loadlane_app;--> statement-breakpoint
REVOKE UPDATE ON "driver_consent" FROM loadlane_app;--> statement-breakpoint
GRANT UPDATE (withdrawn_at) ON "driver_consent" TO loadlane_app;--> statement-breakpoint
ALTER TABLE "driver_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "driver_link" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "driver_consent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "driver_consent" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- A driver request knows only the token. The API sets app.driver_token_hash from the hash of the
-- presented token, which makes exactly that one link visible so the organization can be resolved.
CREATE POLICY driver_link_select ON "driver_link" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id() OR token_hash = app_driver_token_hash());--> statement-breakpoint
CREATE POLICY driver_link_insert ON "driver_link" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY driver_link_update ON "driver_link" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY driver_consent_select ON "driver_consent" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY driver_consent_insert ON "driver_consent" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY driver_consent_update ON "driver_consent" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());
