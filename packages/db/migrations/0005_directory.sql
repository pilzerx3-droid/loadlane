CREATE TABLE "carrier" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mc_number" text,
	"dot_number" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carrier_id_org_key" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_id_org_key" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "location" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"timezone" text NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_id_org_key" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "carrier" ADD CONSTRAINT "carrier_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_active_name_key" ON "carrier" USING btree ("organization_id",lower("name")) WHERE "carrier"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "carrier_org_name_idx" ON "carrier" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_active_name_key" ON "customer" USING btree ("organization_id",lower("name")) WHERE "customer"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "customer_org_name_idx" ON "customer" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "location_org_name_idx" ON "location" USING btree ("organization_id","name");--> statement-breakpoint

-- Hand-written addition: updated_at triggers, privileges and tenant isolation (ADR 0002, ADR 0014).
-- Rows are archived, never deleted, so there is no DELETE privilege.
CREATE TRIGGER customer_set_updated_at BEFORE UPDATE ON "customer" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER carrier_set_updated_at BEFORE UPDATE ON "carrier" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER location_set_updated_at BEFORE UPDATE ON "location" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON "customer" TO loadlane_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "carrier" TO loadlane_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "location" TO loadlane_app;--> statement-breakpoint

ALTER TABLE "customer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY customer_select ON "customer" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY customer_insert ON "customer" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY customer_update ON "customer" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint

ALTER TABLE "carrier" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "carrier" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY carrier_select ON "carrier" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY carrier_insert ON "carrier" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY carrier_update ON "carrier" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint

ALTER TABLE "location" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "location" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY location_select ON "location" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY location_insert ON "location" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY location_update ON "location" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());
