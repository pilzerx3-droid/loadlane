CREATE TYPE "public"."tariff_kind" AS ENUM('sell', 'buy');--> statement-breakpoint
CREATE TABLE "tariff" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "tariff_kind" NOT NULL,
	"customer_id" uuid,
	"carrier_id" uuid,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tariff_id_org_key" UNIQUE("id","organization_id"),
	CONSTRAINT "tariff_party_matches_kind" CHECK (("tariff"."kind" = 'sell' AND "tariff"."carrier_id" IS NULL) OR ("tariff"."kind" = 'buy' AND "tariff"."customer_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "tariff_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tariff_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"valid_from" date NOT NULL,
	"note" text,
	"lines" jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tariff_version_id_org_key" UNIQUE("id","organization_id"),
	CONSTRAINT "tariff_version_number_key" UNIQUE("tariff_id","version"),
	CONSTRAINT "tariff_version_valid_from_key" UNIQUE("tariff_id","valid_from"),
	CONSTRAINT "tariff_version_positive" CHECK ("tariff_version"."version" >= 1),
	CONSTRAINT "tariff_version_lines_array" CHECK (jsonb_typeof("tariff_version"."lines") = 'array')
);
--> statement-breakpoint
ALTER TABLE "tariff" ADD CONSTRAINT "tariff_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff" ADD CONSTRAINT "tariff_customer_org_fk" FOREIGN KEY ("customer_id","organization_id") REFERENCES "public"."customer"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff" ADD CONSTRAINT "tariff_carrier_org_fk" FOREIGN KEY ("carrier_id","organization_id") REFERENCES "public"."carrier"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff" ADD CONSTRAINT "tariff_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_version" ADD CONSTRAINT "tariff_version_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_version" ADD CONSTRAINT "tariff_version_tariff_org_fk" FOREIGN KEY ("tariff_id","organization_id") REFERENCES "public"."tariff"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_version" ADD CONSTRAINT "tariff_version_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tariff_org_idx" ON "tariff" USING btree ("organization_id","created_at");--> statement-breakpoint

-- Hand-written addition: privileges and tenant isolation (ADR 0002, ADR 0007).
-- Versions are immutable (insert only). A tariff can be renamed and archived, nothing else changes.
GRANT SELECT, INSERT ON "tariff", "tariff_version" TO loadlane_app;--> statement-breakpoint
GRANT UPDATE (name, archived_at) ON "tariff" TO loadlane_app;--> statement-breakpoint
ALTER TABLE "tariff" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tariff" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tariff_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tariff_version" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tariff_select ON "tariff" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY tariff_insert ON "tariff" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY tariff_update ON "tariff" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY tariff_version_select ON "tariff_version" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY tariff_version_insert ON "tariff_version" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());
