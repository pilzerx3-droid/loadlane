CREATE TABLE "api_key" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	CONSTRAINT "api_key_id_org_key" UNIQUE("id","organization_id"),
	CONSTRAINT "api_key_hash_key" UNIQUE("key_hash"),
	CONSTRAINT "api_key_hash_format" CHECK ("api_key"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "api_key_has_scope" CHECK (cardinality("api_key"."scopes") >= 1),
	CONSTRAINT "api_key_revoked_consistent" CHECK (("api_key"."revoked_at" IS NULL) = ("api_key"."revoked_by_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "external_ref" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"api_key_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"internal_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_ref_unique_key" UNIQUE("organization_id","entity_type","external_id"),
	CONSTRAINT "external_ref_entity_type" CHECK ("external_ref"."entity_type" IN ('transport')),
	CONSTRAINT "external_ref_external_id_length" CHECK (char_length("external_ref"."external_id") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_revoked_by_user_id_app_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_ref" ADD CONSTRAINT "external_ref_api_key_org_fk" FOREIGN KEY ("api_key_id","organization_id") REFERENCES "public"."api_key"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_ref" ADD CONSTRAINT "external_ref_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_org_idx" ON "api_key" USING btree ("organization_id","created_at");--> statement-breakpoint

-- Hand-written addition: privileges and tenant isolation (ADR 0002, ADR 0009).
-- A key is revoked, never deleted; it can also record when it was last used. external_ref is insert only.
CREATE FUNCTION app_api_key_hash() RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
	SELECT nullif(current_setting('app.api_key_hash', true), '')
$$;--> statement-breakpoint
GRANT SELECT, INSERT ON "api_key", "external_ref" TO loadlane_app;--> statement-breakpoint
GRANT UPDATE (last_used_at, revoked_at, revoked_by_user_id) ON "api_key" TO loadlane_app;--> statement-breakpoint
ALTER TABLE "api_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_key" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_ref" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_ref" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- A request with an API key knows only the key: that one row becomes visible so the organization can be resolved.
CREATE POLICY api_key_select ON "api_key" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id() OR key_hash = app_api_key_hash());--> statement-breakpoint
CREATE POLICY api_key_insert ON "api_key" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY api_key_update ON "api_key" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY external_ref_select ON "external_ref" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY external_ref_insert ON "external_ref" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());
