CREATE TABLE "webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_status_code" integer,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "webhook_delivery_endpoint_event_key" UNIQUE("endpoint_id","event_id"),
	CONSTRAINT "webhook_delivery_status" CHECK ("webhook_delivery"."status" IN ('pending', 'delivered', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoint" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"events" text[] NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_by_user_id" uuid,
	CONSTRAINT "webhook_endpoint_id_org_key" UNIQUE("id","organization_id"),
	CONSTRAINT "webhook_endpoint_url_length" CHECK (char_length("webhook_endpoint"."url") BETWEEN 8 AND 500),
	CONSTRAINT "webhook_endpoint_has_event" CHECK (cardinality("webhook_endpoint"."events") >= 1),
	CONSTRAINT "webhook_endpoint_disabled_consistent" CHECK (("webhook_endpoint"."disabled_at" IS NULL) = ("webhook_endpoint"."disabled_by_user_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_endpoint_org_fk" FOREIGN KEY ("endpoint_id","organization_id") REFERENCES "public"."webhook_endpoint"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_disabled_by_user_id_app_user_id_fk" FOREIGN KEY ("disabled_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_delivery_due_idx" ON "webhook_delivery" USING btree ("organization_id","status","next_attempt_at");
--> statement-breakpoint

-- Hand-written addition: privileges, tenant isolation and the outbox trigger (ADR 0002, ADR 0022).
-- An endpoint is switched off, never deleted. A delivery only changes its progress columns.
GRANT SELECT, INSERT ON "webhook_endpoint", "webhook_delivery" TO loadlane_app;--> statement-breakpoint
GRANT UPDATE (disabled_at, disabled_by_user_id) ON "webhook_endpoint" TO loadlane_app;--> statement-breakpoint
GRANT UPDATE (status, attempts, next_attempt_at, last_status_code, last_error_code, delivered_at) ON "webhook_delivery" TO loadlane_app;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_delivery" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY webhook_endpoint_select ON "webhook_endpoint" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY webhook_endpoint_insert ON "webhook_endpoint" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY webhook_endpoint_update ON "webhook_endpoint" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY webhook_delivery_select ON "webhook_delivery" FOR SELECT TO loadlane_app USING (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY webhook_delivery_insert ON "webhook_delivery" FOR INSERT TO loadlane_app WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
CREATE POLICY webhook_delivery_update ON "webhook_delivery" FOR UPDATE TO loadlane_app USING (organization_id = app_organization_id()) WITH CHECK (organization_id = app_organization_id());--> statement-breakpoint
-- Every history entry of a transport becomes one delivery per active endpoint that subscribed to it,
-- inside the same transaction. The payload has no prices, drivers, positions or notes.
CREATE FUNCTION webhook_enqueue_transport_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	transport_number bigint;
	external text;
	body jsonb;
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM webhook_endpoint
		WHERE organization_id = NEW.organization_id AND disabled_at IS NULL
			AND 'transport.status_changed' = ANY(events)
	) THEN
		RETURN NEW;
	END IF;
	SELECT number INTO transport_number FROM transport WHERE id = NEW.transport_id;
	SELECT external_id INTO external FROM external_ref
		WHERE organization_id = NEW.organization_id AND entity_type = 'transport' AND internal_id = NEW.transport_id
		LIMIT 1;
	body := jsonb_build_object(
		'id', NEW.id,
		'type', 'transport.status_changed',
		'createdAt', NEW.occurred_at,
		'data', jsonb_build_object(
			'transportId', NEW.transport_id,
			'reference', 'LL-' || lpad(transport_number::text, 6, '0'),
			'externalId', external,
			'fromStatus', NEW.from_status,
			'toStatus', NEW.to_status,
			'occurredAt', NEW.occurred_at
		)
	);
	INSERT INTO webhook_delivery (organization_id, endpoint_id, event_id, event_type, payload)
	SELECT NEW.organization_id, e.id, NEW.id, 'transport.status_changed', body
	FROM webhook_endpoint e
	WHERE e.organization_id = NEW.organization_id AND e.disabled_at IS NULL
		AND 'transport.status_changed' = ANY(e.events);
	RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER webhook_enqueue_transport_event AFTER INSERT ON "transport_event"
	FOR EACH ROW EXECUTE FUNCTION webhook_enqueue_transport_event();