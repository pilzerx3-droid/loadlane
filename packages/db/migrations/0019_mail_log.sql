CREATE TABLE "mail_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"related_id" uuid,
	"recipient" text NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"provider_message_id" text,
	"sent_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_log_id_org_key" UNIQUE("id","organization_id"),
	CONSTRAINT "mail_log_kind" CHECK ("mail_log"."kind" IN ('tracking_link', 'spot_invitation', 'quote')),
	CONSTRAINT "mail_log_status" CHECK ("mail_log"."status" IN ('sent', 'failed')),
	CONSTRAINT "mail_log_recipient_length" CHECK (char_length("mail_log"."recipient") BETWEEN 3 AND 254)
);
--> statement-breakpoint
ALTER TABLE "mail_log" ADD CONSTRAINT "mail_log_sent_by_user_id_app_user_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_log" ADD CONSTRAINT "mail_log_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_log_org_idx" ON "mail_log" USING btree ("organization_id","created_at");
--> statement-breakpoint

-- Hand-written addition: privileges and tenant isolation (ADR 0002, ADR 0021).
-- The mail log is append only: rows are inserted and read, never changed or deleted.
GRANT SELECT, INSERT ON "mail_log" TO loadlane_app;--> statement-breakpoint
ALTER TABLE "mail_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mail_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY mail_log_select ON "mail_log" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY mail_log_insert ON "mail_log" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());