# ADR 0014: Transport domain model (Phase 2)

Status: Accepted (implemented in backlog P2-02 to P2-05)

## Context

Phase 2 makes transports real: who ships what, from where to where, with which carrier, in which status, with which documents. The product owner delegated the decisions in this ADR on 2026-11-27 ("I trust you"). Revisit them after the first customer interviews.

## Decisions

1. **Master data is separate.** `customer`, `carrier` and `location` are separate tables (different fields and life cycles). All carry `organization_id`, forced row-level security and a unique key `(id, organization_id)` so later tables can use composite foreign keys that cannot point into another organization (ADR 0002). Records are archived, never deleted.
2. **A carrier is a record inside the shipper's organization.** MC and DOT numbers are stored as typed and are not verified. A link to the carrier's own Loadlane organization comes with Spot Freight (Phase 6).
3. **A transport has ordered stops.** `transport` plus `stop` (pickup or delivery) with an appointment window. The window is stored as `timestamptz` and interpreted in the time zone of the stop's location. No separate shipment, load or order entities yet.
4. **Reference numbers.** Every transport gets a per-organization number (`LL-000001`, never reused) from a counter row locked in the same transaction. Free text fields hold the customer reference and PO number.
5. **Status model.** `created → planned → assigned → confirmed → loading → in_transit → at_destination → unloading → delivered → completed`, and `cancelled` from any state before `delivered`. Rules live in `packages/shared` (`transport-status.ts`) and are the only definition: the API, the database check and the web app use them. "Delayed" is not a status: it is derived later from ETA and appointment windows (Phase 4), so a delayed transport keeps its real status.
6. **Events are immutable.** Every status change inserts a `transport_event` row (who, when, from, to, source, note) in the same transaction as the update. The table has no UPDATE or DELETE privilege. Sources are `user` now; `driver`, `integration` and `system` come later. A status can only be changed through one API operation that checks the transition rules.
7. **Capacity data is minimal.** Weight in pounds and a piece count are optional numbers on the transport. Volume, vehicle type and hazmat are left for later phases; fields are added when a screen needs them.
8. **Documents** (P2-07) live in S3-compatible storage; the database keeps metadata only. Downloads use short-lived presigned URLs created after a permission check.
9. **Money is not on the transport yet.** Prices belong to calculations and awards (ADR 0007), not to a transport record. Nothing here mixes markup, margin and contribution.

## Consequences

- A transport always belongs to exactly one organization; two organizations working on the same transport (shipper and carrier) is a later concern (Spot Freight) and will need an explicit sharing model, not a shortcut in these tables.
- Because "delayed" is derived, lists and the dashboard must not offer a "delayed" status filter before Phase 4. They say so honestly.
- Time zones: a stop's window is meaningless without its location's zone, so a stop cannot exist without a location.
