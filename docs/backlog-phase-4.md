# Phase 4: Visibility, alerts and customer tracking

Goal: dispatchers see what needs attention without any estimate. Decisions: ADR 0016. Status: **4a done (alerts, customer tracking link); map, ETA and e-mail wait for provider decisions**.

| ID    | Task                   | Status  | Notes                                                                                                          |
| ----- | ---------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| P4-01 | Alert conditions       | Done    | Shared rules for overdue pickup/delivery, stale position, no position; API fields on detail; dashboard counts. |
| P4-02 | Alerts list page       | Done    | `/alerts` lists transports with a condition, linking to the transport. Permission `transport:read`.            |
| P4-03 | Customer tracking link | Done    | Hashed token, expiry, revoke; public read-only page with released fields only.                                 |
| P4-04 | Map                    | Blocked | Needs a tile provider decision. MapLibre with configurable style URL; coordinate list without one.             |
| P4-05 | ETA                    | Blocked | Needs a routing provider decision (cost). Behind `RoutingProvider` (ADR 0004).                                 |
| P4-06 | Notifications (e-mail) | Blocked | Needs a mail provider decision.                                                                                |
