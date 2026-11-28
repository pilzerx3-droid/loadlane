# ADR 0020: Partner API keys and idempotent inbound calls

Status: Accepted. Builds on ADR 0009 (integration layer).

## Decisions

1. **Keys belong to the organization.** An administrator creates a key (`integration:manage`); it carries scopes (`lookup:read`, `transport:write`), is shown once, and only its SHA-256 hash is stored (`api_key`). A presented key makes exactly its own row visible through `app.api_key_hash`, like the capability links. Revoking is immediate; a key is never edited or deleted.
2. **Unknown and revoked keys look the same** (`401 invalid_api_key`). A missing scope is `403 scope_missing`.
3. **A key acts for the organization, not for a person.** Transports it creates are owned by the key's creator (the database needs an owner) but the history source is `integration`, the actor empty, and the audit entry `api_key` with the key id. The key itself never appears in a log or an audit entry.
4. **Inbound calls are idempotent by an external id.** `external_ref` maps (organization, entity type, external id) to the created record with a hash of the content. The same id with the same content returns the same record; the same id with different content is a `409`, never an overwrite. Parallel duplicates create exactly one record (unique constraint, the loser reads the winner).
5. **The API uses ids, not names**, and offers lookups so a partner can find them. Partners cannot set `quoteId`.
6. **This is not a SAP interface.** It is Loadlane's own API. A SAP connector (OData or IDoc, mapping, error handling) would call it or live beside it and starts against labeled mock responses (ADR 0009) until a test system exists.

## Consequences

- Any ERP, TMS or middleware that can send JSON can create transports today; retries are safe.
- Not yet: webhooks (outbox), updates and status changes through the API, per-key rate limits, key expiry dates.
