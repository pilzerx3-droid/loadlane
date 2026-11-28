# ADR 0022: Outgoing webhooks

Status: Accepted

## Context

Partner systems (ERP, TMS) want to be told when a transport changes status instead of polling. The inbound side exists (ADR 0020). Events must not be lost when a process stops, receivers can be slow or down, and a customer-supplied address must never become a way to reach our internal network.

## Decision

- **Outbox in the database.** A trigger on `transport_event` writes one `webhook_delivery` row per active endpoint that subscribed, in the same transaction as the event. Every source of status changes (staff, driver, carrier award, partner API) is covered without touching each code path. Event types: `transport.status_changed`, `quote.status_changed` (a quote moved to sent, accepted, rejected or cancelled) and `spot.status_changed` (an offer awarded or cancelled); the latter two come from triggers on the status column and carry no prices, customers, bids or carrier names. A new endpoint subscribes to all types by default.
- **Payload** is fixed when the event happens: event id, type, time, transport id, reference, the partner's own id (`externalId`) when the transport came through the API, old and new status. No prices, notes, drivers, positions or documents.
- **Delivery by the worker** every 15 seconds. It visits each organization on its own (as the retention job does), so row-level security limits what it reads and writes. A 2xx answer completes a delivery. Anything else is retried after 1 min, 5 min, 30 min, 2 h and 12 h; the sixth failure marks it failed. Delivery is at least once: receivers use the event id to ignore repeats.
- **Signature.** Header `X-Loadlane-Signature: t=<unix seconds>,v1=<hex>` where v1 is HMAC-SHA256 over `<t>.<raw body>` with the endpoint secret. Also `X-Loadlane-Event` and `X-Loadlane-Event-Id`.
- **Secrets.** Shown once at creation. Stored encrypted with AES-256-GCM using `WEBHOOK_ENCRYPTION_KEY` (32 random bytes, base64), because the worker needs the plain value to sign. Without the key creating an endpoint answers 503 and the worker does not deliver. Losing or rotating the key means endpoints must be re-created.
- **Address safety.** https only (http only with `WEBHOOK_ALLOW_PRIVATE_HOSTS=true`, for development). The connection refuses loopback, private, link-local and similar addresses, checked inside the connection's own DNS lookup and for literal IP addresses; redirects are not followed; 10 second timeout.
- Endpoints are switched off, never deleted. The delivery list shows status codes and stable error codes, never bodies.

## Consequences

- No outbound call is claimed to work against a partner system until tested with a real receiver; the tests use a local HTTP receiver.
- Old deliveries accumulate; a retention rule for them is part of the later retention decision (postponed by the product owner).
- More event types (quote status, spot award) are a trigger plus an entry in the allowed list.
