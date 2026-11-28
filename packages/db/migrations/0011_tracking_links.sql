CREATE TABLE "tracking_link" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"transport_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracking_link_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "tracking_link_hash_format" CHECK ("tracking_link"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "tracking_link_revoked_consistent" CHECK (("tracking_link"."revoked_at" IS NULL) = ("tracking_link"."revoked_by_user_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "tracking_link" ADD CONSTRAINT "tracking_link_revoked_by_user_id_app_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_link" ADD CONSTRAINT "tracking_link_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_link" ADD CONSTRAINT "tracking_link_transport_org_fk" FOREIGN KEY ("transport_id","organization_id") REFERENCES "public"."transport"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_link" ADD CONSTRAINT "tracking_link_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tracking_link_org_transport_idx" ON "tracking_link" USING btree ("organization_id","transport_id","created_at");--> statement-breakpoint

-- Hand-written addition: privileges and tenant isolation (ADR 0002, ADR 0017).
-- A link is revoked by setting revoked_at, never deleted; only the revocation columns can change.
CREATE FUNCTION app_tracking_token_hash() RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
	SELECT nullif(current_setting('app.tracking_token_hash', true), '')
$$;--> statement-breakpoint
GRANT SELECT, INSERT ON "tracking_link" TO loadlane_app;--> statement-breakpoint
GRANT UPDATE (revoked_at, revoked_by_user_id) ON "tracking_link" TO loadlane_app;--> statement-breakpoint
ALTER TABLE "tracking_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tracking_link" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tracking_link_select ON "tracking_link" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id() OR token_hash = app_tracking_token_hash());--> statement-breakpoint
CREATE POLICY tracking_link_insert ON "tracking_link" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY tracking_link_update ON "tracking_link" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());
