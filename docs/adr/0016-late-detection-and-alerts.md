# ADR 0016: Late detection and alerts without routing

Status: Accepted (Phase 4a).

## Context

Phase 4 asks for ETA, late warnings, alerts and a customer tracking page. ETA needs a routing provider and a tile provider, which cost money and need a product-owner decision (ADR 0004 keeps routing behind an interface). Loadlane must never present an estimate as a fact (CLAUDE.md rule 2).

## Decisions

1. **Start with what real data proves.** "Overdue" is derived only from planned windows and recorded events: a transport is `overdue_pickup` when its first pickup window ended and it has not reached loading, `overdue_delivery` when its last delivery window ended and it is not delivered or completed. These are facts about the plan, labeled "past the planned window", never "ETA".
2. **No ETA until a routing provider is approved.** The API returns no `eta` field. When a provider exists it is added behind the `RoutingProvider` interface and every ETA carries its provider and calculation time.
3. **Alert conditions are derived, not stored.** `overdue_pickup`, `overdue_delivery`, `position_stale` (on the road, last position older than 30 minutes) and `no_position` (on the road, none received). The API computes them from current data; a later notification layer (e-mail, in-app) subscribes to changes. Deriving avoids alerts that disagree with the data.
4. **Customer tracking link** is a separate capability link (hashed token, expiry, revocable) with its own read-only view of fields the dispatcher released; the position is shown only when the transport is on the road, always with its age. Built after the alert slice.
5. **Map** uses MapLibre with a configurable style URL. Without a configured tile provider the page lists coordinates and does not draw a fake basemap.

## Consequences

- The dashboard can show real "overdue" counts now.
- Product owner decisions still open: tile provider, routing provider (cost), notification channels.
