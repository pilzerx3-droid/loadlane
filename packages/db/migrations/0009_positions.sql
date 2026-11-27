CREATE TABLE "last_position" (
	"transport_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"accuracy_m" real,
	"low_quality" boolean DEFAULT false NOT NULL,
	CONSTRAINT "last_position_transport_org_key" UNIQUE("transport_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "position_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"transport_id" uuid NOT NULL,
	"driver_link_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"accuracy_m" real,
	"low_quality" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_event_latitude_range" CHECK ("position_event"."latitude" BETWEEN -90 AND 90),
	CONSTRAINT "position_event_longitude_range" CHECK ("position_event"."longitude" BETWEEN -180 AND 180),
	CONSTRAINT "position_event_accuracy_nonneg" CHECK ("position_event"."accuracy_m" IS NULL OR "position_event"."accuracy_m" >= 0)
);
--> statement-breakpoint
ALTER TABLE "last_position" ADD CONSTRAINT "last_position_transport_org_fk" FOREIGN KEY ("transport_id","organization_id") REFERENCES "public"."transport"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "last_position" ADD CONSTRAINT "last_position_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_event" ADD CONSTRAINT "position_event_transport_org_fk" FOREIGN KEY ("transport_id","organization_id") REFERENCES "public"."transport"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_event" ADD CONSTRAINT "position_event_link_org_fk" FOREIGN KEY ("driver_link_id","organization_id") REFERENCES "public"."driver_link"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_event" ADD CONSTRAINT "position_event_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "last_position_org_idx" ON "last_position" USING btree ("organization_id","recorded_at");--> statement-breakpoint
CREATE INDEX "position_event_transport_time_idx" ON "position_event" USING btree ("organization_id","transport_id","recorded_at");--> statement-breakpoint

-- Hand-written addition: privileges and tenant isolation (ADR 0002, ADR 0015).
-- Positions are appended, never updated. DELETE exists only for the retention job.
GRANT SELECT, INSERT, DELETE ON "position_event" TO loadlane_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "last_position" TO loadlane_app;--> statement-breakpoint
ALTER TABLE "position_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "position_event" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "last_position" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "last_position" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY position_event_select ON "position_event" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY position_event_insert ON "position_event" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY position_event_delete ON "position_event" FOR DELETE TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY last_position_select ON "last_position" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY last_position_insert ON "last_position" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY last_position_update ON "last_position" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY last_position_delete ON "last_position" FOR DELETE TO loadlane_app USING (organization_id = app_organization_id());
