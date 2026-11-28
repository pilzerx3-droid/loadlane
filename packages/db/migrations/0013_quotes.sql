ALTER TABLE "calculation" ADD CONSTRAINT "calculation_id_org_key" UNIQUE("id","organization_id");--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'accepted', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "quote" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"calculation_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"price_cents" bigint NOT NULL,
	"valid_until" date NOT NULL,
	"terms" text,
	"notes" text,
	"sent_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_id_org_key" UNIQUE("id","organization_id"),
	CONSTRAINT "quote_org_number_key" UNIQUE("organization_id","number"),
	CONSTRAINT "quote_price_nonnegative" CHECK ("quote"."price_cents" >= 0),
	CONSTRAINT "quote_sent_consistent" CHECK (("quote"."status" IN ('draft', 'cancelled')) OR "quote"."sent_at" IS NOT NULL),
	CONSTRAINT "quote_decided_consistent" CHECK (("quote"."status" IN ('accepted', 'rejected')) = ("quote"."decided_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "quote_counter" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_calculation_org_fk" FOREIGN KEY ("calculation_id","organization_id") REFERENCES "public"."calculation"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_customer_org_fk" FOREIGN KEY ("customer_id","organization_id") REFERENCES "public"."customer"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_counter" ADD CONSTRAINT "quote_counter_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_org_status_idx" ON "quote" USING btree ("organization_id","status","created_at");--> statement-breakpoint

-- Hand-written addition: privileges and tenant isolation (ADR 0002).
-- A quote is never deleted. Only status, send/decision times and the draft text fields can change;
-- the price, calculation, customer and number are fixed once created.
GRANT SELECT, INSERT, UPDATE ON "quote_counter" TO loadlane_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "quote" TO loadlane_app;--> statement-breakpoint
GRANT UPDATE (status, valid_until, terms, notes, sent_at, decided_at) ON "quote" TO loadlane_app;--> statement-breakpoint
ALTER TABLE "quote_counter" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quote_counter" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quote" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quote" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY quote_counter_select ON "quote_counter" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY quote_counter_insert ON "quote_counter" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY quote_counter_update ON "quote_counter" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY quote_select ON "quote" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY quote_insert ON "quote" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY quote_update ON "quote" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());
