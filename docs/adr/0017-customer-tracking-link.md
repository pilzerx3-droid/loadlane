# ADR 0017: Customer tracking link

Status: Accepted (Phase 4).

## Decisions

1. **Capability link, not an account.** Staff create a link per transport; the URL carries a random 256-bit token, only its SHA-256 hash is stored (`tracking_link`). Links expire (default 30 days after creation, at most 90) and can be revoked. A presented token makes exactly its own row visible through `app.tracking_token_hash`, like the Driver Link (ADR 0015).
2. **Released fields only.** The public view returns the Loadlane reference, the customer's own reference, the status, the stops (place name, city, state, planned window in the stop's time zone) and the status history (status and time). It never returns prices, carrier, driver, notes, actors, documents or ids of other records.
3. **No driver position on this page.** The driver's consent names the booking company and the carrier as recipients (`CONSENT_COPY`). Showing a position to the shipper's customer would exceed that consent. Adding it needs new consent wording (raise `CONSENT_TEXT_VERSION`) and a legal review: an open product-owner question.
4. **Same answers as the Driver Link:** 404 for an unknown token, 410 for revoked or expired. Header `X-Tracking-Token`; the token never appears in a URL we call, a log or an audit entry.

## Consequences

- Customers get a useful status page without a position, which Loadlane would otherwise have to guess.
- Map and live position for customers are blocked on consent wording, not on engineering.
