-- More webhook events (ADR 0022): quote and spot freight status changes. Hand-written: no table changes.
-- One helper queues a delivery for every active endpoint of the organization that subscribed to the type.
CREATE FUNCTION webhook_enqueue(org uuid, event_type text, body jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
	INSERT INTO webhook_delivery (organization_id, endpoint_id, event_id, event_type, payload)
	SELECT org, e.id, (body ->> 'id')::uuid, event_type, body
	FROM webhook_endpoint e
	WHERE e.organization_id = org AND e.disabled_at IS NULL AND event_type = ANY(e.events);
END
$$;--> statement-breakpoint
-- A quote that changes status (sent, accepted, rejected, cancelled). No price, no customer.
CREATE FUNCTION webhook_enqueue_quote_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	PERFORM webhook_enqueue(NEW.organization_id, 'quote.status_changed', jsonb_build_object(
		'id', gen_random_uuid(),
		'type', 'quote.status_changed',
		'createdAt', now(),
		'data', jsonb_build_object(
			'quoteId', NEW.id,
			'reference', 'QT-' || lpad(NEW.number::text, 6, '0'),
			'fromStatus', OLD.status,
			'toStatus', NEW.status,
			'occurredAt', now()
		)
	));
	RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER webhook_enqueue_quote_status AFTER UPDATE OF status ON "quote"
	FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
	EXECUTE FUNCTION webhook_enqueue_quote_status();--> statement-breakpoint
-- A spot freight offer that is awarded or cancelled. No bids, prices or carrier names.
CREATE FUNCTION webhook_enqueue_spot_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	transport_number bigint;
BEGIN
	SELECT number INTO transport_number FROM transport WHERE id = NEW.transport_id;
	PERFORM webhook_enqueue(NEW.organization_id, 'spot.status_changed', jsonb_build_object(
		'id', gen_random_uuid(),
		'type', 'spot.status_changed',
		'createdAt', now(),
		'data', jsonb_build_object(
			'tenderId', NEW.id,
			'transportId', NEW.transport_id,
			'reference', 'LL-' || lpad(transport_number::text, 6, '0'),
			'fromStatus', OLD.status,
			'toStatus', NEW.status,
			'occurredAt', now()
		)
	));
	RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER webhook_enqueue_spot_status AFTER UPDATE OF status ON "spot_tender"
	FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
	EXECUTE FUNCTION webhook_enqueue_spot_status();
