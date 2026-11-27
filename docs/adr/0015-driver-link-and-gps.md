# ADR 0015: Driver Link and GPS tracking

Status: Proposed (Phase 3). Builds on ADR 0006 (positions as events) and ADR 0014 (transports).

## Context

Drivers are usually employees or contractors of a carrier, not users of Loadlane. They must be able to report status and share their position from a phone without an account, and only after they know what is collected and why. GPS data about a person is sensitive: no hidden tracking, no invented positions.

## Decisions

1. **Driver Link is a capability URL.** A dispatcher creates a link for one transport. The URL carries a random 256-bit token. Only a SHA-256 hash of the token is stored (`driver_link`: organization_id, transport_id, token_hash, expires_at, revoked_at, created_by). A link has an expiry (default: 48 hours after the last stop window ends), can be revoked, and is scoped to exactly one transport. The token never appears in logs (the API already never logs paths with secrets; the route uses a header or body token, not a query value).
2. **Driver access is not a user session.** Routes under `/v1/driver/*` are `@Public()` in the permission sense but authenticated by the link token, resolve to one (organization, transport) pair, and then run through `withTenant()`. A driver can only: read the minimal transport view (stops, windows, addresses, reference), post a status event from a short allowed list, upload a document of the allowed types, and post positions. Nothing else. Rate limits apply per link.
3. **Consent comes first.** The driver sees a consent screen before the browser asks for location. It states: what is collected (position, accuracy, time), when (only while this page is open and sharing is on), who sees it (the shipper and the carrier on this transport), how long it is kept, and that sharing can be stopped at any time with one button. Consent is stored (`driver_consent`: link id, text version, accepted_at, withdrawn_at). Without a stored consent the position endpoint answers `403 consent_required`. Declining still allows manual status updates (ADR 0006: manual fallback).
4. **Positions are append-only events** (ADR 0006): `position_event` (organization_id, transport_id, recorded_at from the device, received_at from the server, lat, lng, accuracy_m, source = `driver_link`), plus one `last_position` row per transport updated in the same transaction. Decided while implementing (P3-04): plain `latitude`/`longitude` columns and a single table with an index on (organization, transport, recorded_at). Monthly partitioning and a PostGIS `geography` column are deferred to Phase 4 (maps, geofences), where distance queries need them; adding them later is a migration, not a model change. Server rejects implausible input (out of range, recorded_at more than 5 minutes in the future, accuracy over 5,000 m is stored but flagged low-quality). We never interpolate, smooth or fill gaps.
5. **Staleness is derived**, never stored: a position is `fresh` under 5 minutes, `aging` under 30, `stale` beyond (thresholds in `packages/shared`, per-organization override later). The UI always shows the timestamp next to the position and marks stale data visibly. If there is no position the UI says so ("No position received"), it never shows a guess.
6. **Browser limits are stated openly.** A PWA cannot track reliably in the background. The Driver Link page keeps the screen awake (Screen Wake Lock where supported) and tells the driver that tracking pauses when the page is closed or the phone locks. The product claims "position while the page is open", not continuous tracking. Native apps are a later option.
7. **Retention.** Position events are deleted (or reduced to the last position) a fixed number of days after the transport is completed. The number of days is a **legal/commercial decision for the product owner** and is not hard-coded as a guess: it is an organization setting that defaults to 30 days until confirmed.
8. **Customer tracking page** (public, read-only link for the shipper's customer) is a separate capability URL in Phase 4 and shows only fields the dispatcher released. Not part of Phase 3.

## Consequences

- New tables (`driver_link`, `driver_consent`, `position_event`, `last_position`) each need forced RLS and a two-organization test. Driver routes are the first routes outside the user permission model and get their own e2e test matrix (valid, expired, revoked, wrong transport, no consent).
- `transport_event.source` gains `driver` (already reserved in ADR 0014).
- The PWA needs HTTPS in production (geolocation requires a secure context); on localhost it works for development.
- Open for the product owner: consent wording reviewed by counsel, retention days, whether carriers (not only shippers) see positions in the transport list, state laws on employee location tracking.
