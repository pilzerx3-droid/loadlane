# ADR 0019: Spot freight model

Status: Accepted (Phase 6).

## Context

EXECUTE pillar: offer a load to selected carriers, compare bids, award, then track the transport. ADR 0014 made carriers plain records inside the shipper's organization; real carrier organizations and users do not exist yet. The first version is a closed, controlled process (masterprompt C2), not a marketplace.

## Decisions

1. **A tender belongs to an existing transport.** A transport without a carrier (status created or planned) already has stops, windows, weight and references. A tender (`spot_tender`) points at it; nothing is copied. Awarding sets the carrier on that same transport and moves it to `assigned` through the normal status rules, so tracking, documents and Driver Link work unchanged ("offer, award and track in one place").
2. **Carriers take part through capability links, not accounts.** Inviting a carrier creates a `spot_invitation` with a random token (hash stored, expiry, revocable), the same pattern as Driver Link and customer tracking. The carrier opens the link, sees the lane and the planned windows, and submits or withdraws a price. No carrier login is needed in this phase; carrier organizations can come later without changing the tender model.
3. **Bids can also be entered by the shipper** for offers received by phone or e-mail (`submitted_by = shipper`), clearly marked as entered by staff.
4. **A bid is append-only in meaning.** A carrier may withdraw and submit again; every submission is a new row (price in cents, free-text availability note) and the earlier one is marked `superseded`. The history stays for review. Price is the only money field; there is no markup or margin here (those stay in calculations).
5. **The award is a human decision.** Loadlane never picks the cheapest bid automatically. Awarding records who awarded, when, which bid and optionally a note, in the audit log and as the transport status event. All other open bids are marked `rejected`, the tender becomes `awarded` and every invitation link of the tender is closed.
6. **What a carrier sees through the link:** lane (city and state of each stop, planned windows in local time), weight and pieces, the response deadline and the carrier's own bids. Never the customer, the shipper's target price, other carriers or their prices.
7. **No claims about a marketplace.** Publishing to an open or network-wide market is out of scope until the closed process is validated with real users.

## Consequences

- Spot freight reuses transport, carrier, audit and the capability-link pattern; the new tables are tender, invitation and bid.
- Open for the product owner: whether the shipper's target price ("ceiling") should be shown to invited carriers, and the legal wording carriers see before bidding (not drafted by Loadlane).
