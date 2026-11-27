CREATE TYPE "public"."document_type" AS ENUM('delivery_note', 'bill_of_lading', 'proof_of_delivery', 'photo', 'other');--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"transport_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" uuid,
	CONSTRAINT "document_id_org_key" UNIQUE("id","organization_id"),
	CONSTRAINT "document_storage_key_key" UNIQUE("storage_key"),
	CONSTRAINT "document_size_positive" CHECK ("document"."size_bytes" > 0),
	CONSTRAINT "document_deleted_consistent" CHECK (("document"."deleted_at" IS NULL) = ("document"."deleted_by_user_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_uploaded_by_user_id_app_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_deleted_by_user_id_app_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_transport_org_fk" FOREIGN KEY ("transport_id","organization_id") REFERENCES "public"."transport"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_org_transport_idx" ON "document" USING btree ("organization_id","transport_id","created_at");--> statement-breakpoint

-- Hand-written addition: privileges and tenant isolation (ADR 0002, ADR 0014).
-- Documents are marked deleted (UPDATE), never removed from the table, so there is no DELETE privilege.
GRANT SELECT, INSERT, UPDATE ON "document" TO loadlane_app;--> statement-breakpoint
ALTER TABLE "document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY document_select ON "document" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY document_insert ON "document" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY document_update ON "document" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());
