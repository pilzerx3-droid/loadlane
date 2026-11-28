CREATE TYPE "public"."spot_bid_status" AS ENUM('submitted', 'superseded', 'withdrawn', 'rejected', 'awarded');--> statement-breakpoint
CREATE TYPE "public"."spot_tender_status" AS ENUM('open', 'awarded', 'cancelled', 'closed');--> statement-breakpoint
CREATE TABLE "spot_bid" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"invitation_id" uuid,
	"price_cents" bigint NOT NULL,
	"note" text,
	"status" "spot_bid_status" DEFAULT 'submitted' NOT NULL,
	"entered_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spot_bid_id_org_key" UNIQUE("id","organization_id"),
	CONSTRAINT "spot_bid_price_positive" CHECK ("spot_bid"."price_cents" > 0),
	CONSTRAINT "spot_bid_source_consistent" CHECK (("spot_bid"."invitation_id" IS NULL) = ("spot_bid"."entered_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "spot_invitation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spot_invitation_id_org_key" UNIQUE("id","organization_id"),
	CONSTRAINT "spot_invitation_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "spot_invitation_tender_carrier_key" UNIQUE("tender_id","carrier_id"),
	CONSTRAINT "spot_invitation_hash_format" CHECK ("spot_invitation"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "spot_invitation_revoked_consistent" CHECK (("spot_invitation"."revoked_at" IS NULL) = ("spot_invitation"."revoked_by_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "spot_tender" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"transport_id" uuid NOT NULL,
	"status" "spot_tender_status" DEFAULT 'open' NOT NULL,
	"response_deadline" timestamp with time zone NOT NULL,
	"target_price_cents" bigint,
	"notes" text,
	"awarded_at" timestamp with time zone,
	"awarded_by_user_id" uuid,
	"closed_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spot_tender_id_org_key" UNIQUE("id","organization_id"),
	CONSTRAINT "spot_tender_target_nonnegative" CHECK ("spot_tender"."target_price_cents" IS NULL OR "spot_tender"."target_price_cents" >= 0),
	CONSTRAINT "spot_tender_award_consistent" CHECK (("spot_tender"."status" = 'awarded') = ("spot_tender"."awarded_at" IS NOT NULL AND "spot_tender"."awarded_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "spot_bid" ADD CONSTRAINT "spot_bid_entered_by_user_id_app_user_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_bid" ADD CONSTRAINT "spot_bid_tender_org_fk" FOREIGN KEY ("tender_id","organization_id") REFERENCES "public"."spot_tender"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_bid" ADD CONSTRAINT "spot_bid_carrier_org_fk" FOREIGN KEY ("carrier_id","organization_id") REFERENCES "public"."carrier"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_bid" ADD CONSTRAINT "spot_bid_invitation_org_fk" FOREIGN KEY ("invitation_id","organization_id") REFERENCES "public"."spot_invitation"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_bid" ADD CONSTRAINT "spot_bid_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_invitation" ADD CONSTRAINT "spot_invitation_revoked_by_user_id_app_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_invitation" ADD CONSTRAINT "spot_invitation_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_invitation" ADD CONSTRAINT "spot_invitation_tender_org_fk" FOREIGN KEY ("tender_id","organization_id") REFERENCES "public"."spot_tender"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_invitation" ADD CONSTRAINT "spot_invitation_carrier_org_fk" FOREIGN KEY ("carrier_id","organization_id") REFERENCES "public"."carrier"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_invitation" ADD CONSTRAINT "spot_invitation_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_tender" ADD CONSTRAINT "spot_tender_awarded_by_user_id_app_user_id_fk" FOREIGN KEY ("awarded_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_tender" ADD CONSTRAINT "spot_tender_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_tender" ADD CONSTRAINT "spot_tender_transport_org_fk" FOREIGN KEY ("transport_id","organization_id") REFERENCES "public"."transport"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_tender" ADD CONSTRAINT "spot_tender_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spot_bid_one_live_per_carrier" ON "spot_bid" USING btree ("tender_id","carrier_id") WHERE "spot_bid"."status" IN ('submitted', 'awarded');--> statement-breakpoint
CREATE UNIQUE INDEX "spot_bid_one_awarded_per_tender" ON "spot_bid" USING btree ("tender_id") WHERE "spot_bid"."status" = 'awarded';--> statement-breakpoint
CREATE INDEX "spot_bid_tender_idx" ON "spot_bid" USING btree ("organization_id","tender_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "spot_tender_one_open_per_transport" ON "spot_tender" USING btree ("transport_id") WHERE "spot_tender"."status" = 'open';--> statement-breakpoint
CREATE INDEX "spot_tender_org_status_idx" ON "spot_tender" USING btree ("organization_id","status","created_at");--> statement-breakpoint

-- Hand-written addition: privileges and tenant isolation (ADR 0002, ADR 0019).
-- Nothing in spot freight is deleted. Tenders, invitations and bids change only in the listed columns.
CREATE FUNCTION app_spot_token_hash() RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
	SELECT nullif(current_setting('app.spot_token_hash', true), '')
$$;--> statement-breakpoint
GRANT SELECT, INSERT ON "spot_tender", "spot_invitation", "spot_bid" TO loadlane_app;--> statement-breakpoint
GRANT UPDATE (status, response_deadline, target_price_cents, notes, awarded_at, awarded_by_user_id, closed_at) ON "spot_tender" TO loadlane_app;--> statement-breakpoint
GRANT UPDATE (revoked_at, revoked_by_user_id) ON "spot_invitation" TO loadlane_app;--> statement-breakpoint
GRANT UPDATE (status) ON "spot_bid" TO loadlane_app;--> statement-breakpoint
ALTER TABLE "spot_tender" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "spot_tender" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "spot_invitation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "spot_invitation" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "spot_bid" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "spot_bid" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY spot_tender_select ON "spot_tender" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY spot_tender_insert ON "spot_tender" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY spot_tender_update ON "spot_tender" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
-- A carrier's request knows only its token: that one invitation row becomes visible so the organization can be resolved.
CREATE POLICY spot_invitation_select ON "spot_invitation" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id() OR token_hash = app_spot_token_hash());--> statement-breakpoint
CREATE POLICY spot_invitation_insert ON "spot_invitation" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY spot_invitation_update ON "spot_invitation" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY spot_bid_select ON "spot_bid" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY spot_bid_insert ON "spot_bid" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY spot_bid_update ON "spot_bid" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());
