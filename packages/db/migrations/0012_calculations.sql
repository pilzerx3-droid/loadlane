CREATE TABLE "calculation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid,
	"name" text NOT NULL,
	"engine_version" integer NOT NULL,
	"pricing_mode" text NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"cost_cents" bigint NOT NULL,
	"price_cents" bigint NOT NULL,
	"contribution_cents" bigint NOT NULL,
	"markup_bp" integer,
	"margin_bp" integer,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calculation_amounts_nonnegative" CHECK ("calculation"."cost_cents" >= 0 AND "calculation"."price_cents" >= 0),
	CONSTRAINT "calculation_contribution_consistent" CHECK ("calculation"."contribution_cents" = "calculation"."price_cents" - "calculation"."cost_cents"),
	CONSTRAINT "calculation_pricing_mode" CHECK ("calculation"."pricing_mode" IN ('markup', 'margin', 'contribution', 'price'))
);
--> statement-breakpoint
ALTER TABLE "calculation" ADD CONSTRAINT "calculation_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculation" ADD CONSTRAINT "calculation_customer_org_fk" FOREIGN KEY ("customer_id","organization_id") REFERENCES "public"."customer"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculation" ADD CONSTRAINT "calculation_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calculation_org_created_idx" ON "calculation" USING btree ("organization_id","created_at");--> statement-breakpoint

-- Hand-written addition: privileges and tenant isolation (ADR 0002, ADR 0007).
-- A calculation is a frozen snapshot: it can be read and created, never updated or deleted.
GRANT SELECT, INSERT ON "calculation" TO loadlane_app;--> statement-breakpoint
ALTER TABLE "calculation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calculation" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY calculation_select ON "calculation" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY calculation_insert ON "calculation" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());
