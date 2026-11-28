CREATE TABLE "eta_estimate" (
	"transport_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"based_on_recorded_at" timestamp with time zone NOT NULL,
	"from_latitude" double precision NOT NULL,
	"from_longitude" double precision NOT NULL,
	"distance_m" integer NOT NULL,
	"duration_s" integer NOT NULL,
	"eta_at" timestamp with time zone NOT NULL,
	"provider" text NOT NULL,
	CONSTRAINT "eta_estimate_nonnegative" CHECK ("eta_estimate"."distance_m" >= 0 AND "eta_estimate"."duration_s" >= 0),
	CONSTRAINT "eta_estimate_provider" CHECK ("eta_estimate"."provider" IN ('openrouteservice'))
);
--> statement-breakpoint
ALTER TABLE "eta_estimate" ADD CONSTRAINT "eta_estimate_transport_org_fk" FOREIGN KEY ("transport_id","organization_id") REFERENCES "public"."transport"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eta_estimate" ADD CONSTRAINT "eta_estimate_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Hand-written addition: privileges and tenant isolation (ADR 0002, ADR 0021).
-- An estimate is replaced by the next one (insert or update) and never deleted by the application.
GRANT SELECT, INSERT, UPDATE ON "eta_estimate" TO loadlane_app;--> statement-breakpoint
ALTER TABLE "eta_estimate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "eta_estimate" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY eta_estimate_select ON "eta_estimate" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY eta_estimate_insert ON "eta_estimate" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY eta_estimate_update ON "eta_estimate" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());