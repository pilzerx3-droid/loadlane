# Phase 2: Transport management

Goal: dispatchers can create and manage transports for real, with parties, a status model, an event history, documents, search and a dashboard. No tracking yet (Phase 3). Status: **proposed, waiting for approval**.

## Decisions to confirm before coding

1. **Parties.** One `party` table per organization (customer, shipper, consignee, carrier as roles of a party) or separate tables. Proposal: separate `customer`, `carrier` tables (they have different fields and lifecycles), plus `location` (address + time zone + coordinates, reused by stops).
2. **Carriers are other organizations or just records?** Proposal for Phase 2: carriers are plain records inside the shipper's organization. Linking to a real carrier organization (carrier_user role) comes with Spot Freight. This keeps tenant isolation simple.
3. **Transport shape.** A transport has an ordered list of stops (pickup, delivery, with appointment windows in the location's time zone). Proposal: `transport` + `stop`, no separate shipment/load entities yet.
4. **Status model.** Proposal: `created → planned → assigned → confirmed → loading → in_transit → at_destination → unloading → delivered → completed`, plus `delayed` as a flag derived later and `cancelled` from any state before `delivered`. Every change is an immutable `transport_event` row (who, when, from, to, source). Transition rules live in `packages/shared` and are tested.
5. **Reference numbers.** Per-organization sequence (`LL-000123`) plus free customer reference and PO number.
6. **Document storage.** SeaweedFS (S3 API) with presigned URLs, size and type limits, virus scanning deferred (documented risk).
7. **Units.** Weight in pounds, distance in miles, stored in SI-neutral form only if needed; start with stored pounds and miles per ADR 0005.

## Tasks

| ID    | Task                           | Acceptance criteria                                                                                                                                                     |
| ----- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-01 | Domain model ADR               | ADR 0014 with entities, relations and the decisions above. Product owner approves.                                                                                      |
| P2-02 | Customers, carriers, locations | Migration with forced RLS and two-organization tests. API CRUD with permissions (new `customer:*`, `carrier:*`, `location:*`). Web list, create, edit, archive.         |
| P2-03 | Transports and stops           | Migration, RLS, tests. Create, edit and cancel transports with stops. Per-organization reference number. Permissions `transport:*`.                                     |
| P2-04 | Status model and events        | Transition rules in `packages/shared` with tests. Status changes only through one API operation that writes the event in the same transaction. Event history in the UI. |
| P2-05 | Transport list and detail      | Filter by status, customer, carrier, date; text search; paging. Detail page with stops, history, parties. Honest empty states.                                          |
| P2-06 | CSV import                     | Upload a CSV, map columns, preview with row-level errors, import in one transaction. Duplicate detection by customer reference. No partial silent failures.             |
| P2-07 | Documents                      | Upload, list, download via presigned URL, type and size limits, per-transport permission checks, audit entry. Test that org B cannot fetch org A's document.            |
| P2-08 | Dashboard                      | Counts of active, planned, delivered today and "no position yet" (always zero until Phase 3, labeled as such). Only real numbers.                                       |
| P2-09 | Audit trail view               | `audit:read` users see changes to transports and documents with who and when.                                                                                           |

## Exit criteria

A dispatcher creates a transport (or imports many), assigns a carrier, moves it through the statuses, attaches a proof of delivery and finds it again by search. Another organization sees none of it, and a test proves it.
