CREATE TYPE "public"."transport_event_source" AS ENUM('user', 'driver', 'integration', 'system');--> statement-breakpoint
CREATE TYPE "public"."stop_type" AS ENUM('pickup', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."transport_status" AS ENUM('created', 'planned', 'assigned', 'confirmed', 'loading', 'in_transit', 'at_destination', 'unloading', 'delivered', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "stop" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"transport_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"type" "stop_type" NOT NULL,
	"location_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"reference" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stop_transport_sequence_key" UNIQUE("transport_id","sequence"),
	CONSTRAINT "stop_sequence_positive" CHECK ("stop"."sequence" >= 1),
	CONSTRAINT "stop_window_order" CHECK ("stop"."window_end" >= "stop"."window_start")
);
--> statement-breakpoint
CREATE TABLE "transport" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" "transport_status" DEFAULT 'created' NOT NULL,
	"customer_id" uuid NOT NULL,
	"carrier_id" uuid,
	"customer_reference" text,
	"purchase_order" text,
	"weight_lb" numeric(12, 2),
	"pieces" integer,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_id_org_key" UNIQUE("id","organization_id"),
	CONSTRAINT "transport_org_number_key" UNIQUE("organization_id","number"),
	CONSTRAINT "transport_weight_positive" CHECK ("transport"."weight_lb" IS NULL OR "transport"."weight_lb" > 0),
	CONSTRAINT "transport_pieces_positive" CHECK ("transport"."pieces" IS NULL OR "transport"."pieces" > 0),
	CONSTRAINT "transport_carrier_required" CHECK ("transport"."carrier_id" IS NOT NULL OR "transport"."status" IN ('created', 'planned', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "transport_counter" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"transport_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "transport_event_source" NOT NULL,
	"actor_user_id" uuid,
	"from_status" "transport_status",
	"to_status" "transport_status" NOT NULL,
	"note" text,
	CONSTRAINT "transport_event_user_actor" CHECK ("transport_event"."source" <> 'user' OR "transport_event"."actor_user_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "stop" ADD CONSTRAINT "stop_transport_org_fk" FOREIGN KEY ("transport_id","organization_id") REFERENCES "public"."transport"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop" ADD CONSTRAINT "stop_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."location"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport" ADD CONSTRAINT "transport_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport" ADD CONSTRAINT "transport_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport" ADD CONSTRAINT "transport_customer_org_fk" FOREIGN KEY ("customer_id","organization_id") REFERENCES "public"."customer"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport" ADD CONSTRAINT "transport_carrier_org_fk" FOREIGN KEY ("carrier_id","organization_id") REFERENCES "public"."carrier"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_counter" ADD CONSTRAINT "transport_counter_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_event" ADD CONSTRAINT "transport_event_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_event" ADD CONSTRAINT "transport_event_transport_org_fk" FOREIGN KEY ("transport_id","organization_id") REFERENCES "public"."transport"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stop_org_transport_idx" ON "stop" USING btree ("organization_id","transport_id");--> statement-breakpoint
CREATE INDEX "stop_org_window_idx" ON "stop" USING btree ("organization_id","window_start");--> statement-breakpoint
CREATE INDEX "transport_org_status_idx" ON "transport" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "transport_org_created_idx" ON "transport" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "transport_org_customer_idx" ON "transport" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "transport_org_carrier_idx" ON "transport" USING btree ("organization_id","carrier_id");--> statement-breakpoint
CREATE INDEX "transport_event_transport_idx" ON "transport_event" USING btree ("organization_id","transport_id","occurred_at");--> statement-breakpoint

-- Hand-written addition: triggers, privileges and tenant isolation (ADR 0002, ADR 0014).
CREATE TRIGGER transport_set_updated_at BEFORE UPDATE ON "transport" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER stop_set_updated_at BEFORE UPDATE ON "stop" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- transport_event is append-only for every database role, including the owner.
CREATE FUNCTION reject_transport_event_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'transport_event is append-only (% not allowed)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER transport_event_reject_row_change BEFORE UPDATE OR DELETE ON "transport_event" FOR EACH ROW EXECUTE FUNCTION reject_transport_event_change();--> statement-breakpoint

-- Transports are cancelled, never deleted. Stops can be replaced while a transport is edited.
GRANT SELECT, INSERT, UPDATE ON "transport_counter" TO loadlane_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "transport" TO loadlane_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "stop" TO loadlane_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "transport_event" TO loadlane_app;--> statement-breakpoint

ALTER TABLE "transport_counter" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transport_counter" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY transport_counter_select ON "transport_counter" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY transport_counter_insert ON "transport_counter" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY transport_counter_update ON "transport_counter" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint

ALTER TABLE "transport" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transport" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY transport_select ON "transport" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY transport_insert ON "transport" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY transport_update ON "transport" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint

ALTER TABLE "stop" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stop" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY stop_select ON "stop" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY stop_insert ON "stop" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY stop_update ON "stop" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY stop_delete ON "stop" FOR DELETE TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint

ALTER TABLE "transport_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transport_event" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY transport_event_select ON "transport_event" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY transport_event_insert ON "transport_event" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());
