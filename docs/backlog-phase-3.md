# Phase 3: Driver Link and GPS

Goal: a driver opens a link on a phone, sees the job, accepts a consent notice, reports status and shares a real position. The dispatcher sees the last known position with its age. Nothing is simulated. Decisions: ADR 0015. Status: **implemented**; verified end to end in the local stack with a throwaway organization.

## Tasks

| ID    | Task                      | Status | Notes                                                                                                                                                                                                                                          |
| ----- | ------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-01 | Driver link tables        | Done   | `driver_link`, `driver_consent`: forced RLS, token stored only as SHA-256 hash, a presented token makes exactly its own link row visible (`app.driver_token_hash`), only revocation columns updatable.                                         |
| P3-02 | Link management API + web | Done   | Create (token shown once), list, revoke; card on the transport page. Default expiry: 48 h after the last stop window.                                                                                                                          |
| P3-03 | Driver API                | Done   | `/v1/driver/{job,consent,consent/withdraw,status,position,documents}` with `X-Driver-Token`. 404 unknown, 410 revoked or expired, 403 `consent_required`, 409 `tracking_closed`. Global per-IP rate limit.                                     |
| P3-04 | Positions storage         | Done   | `position_event` (append-only) and `last_position`, plain lat/lng (partitioning and PostGIS deferred to Phase 4, see ADR 0015). Staleness and plausibility rules in `packages/shared`.                                                         |
| P3-05 | Driver page               | Done   | `/d/[token]`: job, consent screen before any geolocation call, stop sharing, status buttons, photo upload. Not yet a installable PWA (no manifest or service worker).                                                                          |
| P3-06 | Position display          | Done   | Last position with device time, age and Live / Not recent / Outdated, or "No position received". Dashboard counts transports on the road without a position.                                                                                   |
| P3-07 | Retention job             | Done   | organization.position_retention_days (default 30, **legal period still to be confirmed**); pnpm worker:start deletes positions of finished transports after that period, daily, per organization. Tested in packages/db/src/retention.test.ts. |
| P3-08 | Driver uploads            | Done   | Photo or document through the link; `document.uploaded_by_driver_link_id` (exactly one uploader column set); same content checks as staff uploads.                                                                                             |

## Open questions for the product owner

- Consent wording and retention period reviewed by counsel; state law on tracking contractors.
- Whether the carrier organization (not only the shipper) should see positions (needs real carrier organizations, Spot Freight phase).
- Installable PWA (manifest, offline shell) and background tracking limits: native app later?

## Exit criteria

A dispatcher creates a driver link; on a phone the driver declines or accepts consent, sends a status and a position; the dispatcher sees the position with its timestamp and a stale warning when it ages. Another organization sees nothing, a revoked or expired link stops working, and tests prove it.
