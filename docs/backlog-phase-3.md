# Phase 3: Driver Link and GPS

Goal: a driver opens a link on a phone, sees the job, accepts a consent notice, reports status and shares a real position. The dispatcher sees the last known position with its age. Nothing is simulated. Decisions: ADR 0015. Status: **proposed, working autonomously on the defaults in the ADR**.

## Tasks

| ID    | Task                      | Acceptance criteria                                                                                                                                                       |
| ----- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-01 | Driver link tables        | Migration `driver_link`, `driver_consent` with forced RLS, grants, two-organization tests. Token stored only as hash.                                                     |
| P3-02 | Link management API + web | `transport:manage` users create, list and revoke links for a transport; the full URL is shown once. Expiry rules tested. Web card on the transport detail page.           |
| P3-03 | Driver API auth           | `/v1/driver/*` routes authenticated by token: transport view, consent, status, documents. E2E matrix: valid, expired, revoked, other transport, no consent. Rate limited. |
| P3-04 | Positions storage         | `position_event` (monthly partitions) and `last_position` with PostGIS, RLS, tests. Validation and quality flags. Staleness rules in `packages/shared` with tests.        |
| P3-05 | Driver PWA                | Mobile page: job view, consent screen before any geolocation call, share on/off, status buttons, photo/document upload, honest "tracking only while this page is open".   |
| P3-06 | Position display          | Transport detail shows last position, age and fresh/aging/stale marking, or "No position received". Dashboard "no position yet" becomes a real count.                     |
| P3-07 | Retention job             | Setting per organization (default 30 days, pending legal confirmation); worker deletes old position events after completion. Tested.                                      |

## Exit criteria

A dispatcher creates a driver link; on a phone the driver declines or accepts consent, sends a status and a position; the dispatcher sees the position with its timestamp and a stale warning when it ages. Another organization sees nothing, a revoked or expired link stops working, and tests prove it.
