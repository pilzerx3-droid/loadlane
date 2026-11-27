-- Hand-edited additions to the generated SQL: the citext extension (first), role seeds, the
-- updated_at trigger and append-only protection for audit_log (last).
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TYPE "public"."distance_unit" AS ENUM('mi', 'km');--> statement-breakpoint
CREATE TYPE "public"."organization_region" AS ENUM('us', 'eu');--> statement-breakpoint
CREATE TYPE "public"."weight_unit" AS ENUM('lb', 'kg');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'suspended', 'removed');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'system', 'api_key');--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"region" "organization_region" DEFAULT 'us' NOT NULL,
	"distance_unit" "distance_unit" DEFAULT 'mi' NOT NULL,
	"weight_unit" "weight_unit" DEFAULT 'lb' NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "organization_slug_format" CHECK ("organization"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "organization_currency_format" CHECK ("organization"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" "citext" NOT NULL,
	"display_name" text NOT NULL,
	"auth_issuer" text,
	"auth_subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "app_user_auth_identity_pair" CHECK (("app_user"."auth_issuer" IS NULL) = ("app_user"."auth_subject" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "role" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'invited' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_org_user_key" UNIQUE("organization_id","user_id"),
	CONSTRAINT "membership_id_org_key" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "membership_role" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_role_membership_id_role_key_pk" PRIMARY KEY("membership_id","role_key")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"changes" jsonb,
	"request_id" text,
	"ip" "inet",
	"user_agent" text,
	CONSTRAINT "audit_log_user_actor" CHECK ("audit_log"."actor_type" <> 'user' OR "audit_log"."actor_user_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_role" ADD CONSTRAINT "membership_role_role_key_role_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."role"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_role" ADD CONSTRAINT "membership_role_membership_org_fk" FOREIGN KEY ("membership_id","organization_id") REFERENCES "public"."membership"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_key" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_auth_identity_key" ON "app_user" USING btree ("auth_issuer","auth_subject");--> statement-breakpoint
CREATE INDEX "membership_user_idx" ON "membership" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "membership_role_org_idx" ON "membership_role" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_time_idx" ON "audit_log" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_org_entity_idx" ON "audit_log" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint

-- Fixed role catalog (what each role may do is defined in code, P1-07).
INSERT INTO "role" ("key", "description") VALUES
	('admin', 'Manages the organization, its members and settings'),
	('dispatcher', 'Plans and monitors transports'),
	('sales', 'Creates calculations, quotes and spot freight'),
	('carrier_user', 'Works on transports and offers assigned to the carrier organization');--> statement-breakpoint

-- Keeps updated_at current no matter which client writes the row.
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER organization_set_updated_at BEFORE UPDATE ON "organization" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER app_user_set_updated_at BEFORE UPDATE ON "app_user" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER membership_set_updated_at BEFORE UPDATE ON "membership" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- audit_log is append-only for every database role, including the owner.
CREATE FUNCTION reject_audit_log_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only (% not allowed)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_log_reject_row_change BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION reject_audit_log_change();--> statement-breakpoint
CREATE TRIGGER audit_log_reject_truncate BEFORE TRUNCATE ON "audit_log" FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_log_change();
