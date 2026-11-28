# Integration API (for ERP, TMS and middleware)

Another system can create transports in Loadlane with an API key. This is Loadlane's own REST API: nothing here is a SAP interface. A SAP connector (ADR 0009) would sit in front of it (middleware or an adapter in this repository) once a test system exists. Until then the API is tested with Loadlane's own tests only.

## Keys

An administrator creates a key under **Integrations** (or `POST /v1/api-keys`) and picks its scopes:

| Scope             | Allows                                                 |
| ----------------- | ------------------------------------------------------ |
| `lookup:read`     | list customers, carriers and locations (ids and names) |
| `transport:write` | create transports                                      |

The key (`ll_live_...`) is shown **once**. Loadlane stores only a hash. Send it in the header `X-Api-Key`, never in a URL. A revoked or unknown key gets `401 invalid_api_key`; a key without the needed scope gets `403 scope_missing`. A key acts for its organization, not for a person: transports it creates are recorded with source `integration` in the history and `api_key` in the audit log.

## Look up ids

```
GET /v1/integration/lookups/{customers|carriers|locations}?q=part&limit=100&offset=0
X-Api-Key: ll_live_...
```

Returns `items` with `id` and `name` (locations also `city`, `state`, `timezone`) and `page.total`. Archived records are not listed.

## Create a transport

```
POST /v1/integration/transports
X-Api-Key: ll_live_...
Content-Type: application/json

{
  "externalId": "SAP-4711",
  "transport": {
    "customerId": "...",
    "customerReference": "PO-9",
    "weightLb": 12000,
    "stops": [
      { "type": "pickup",   "locationId": "...", "windowStart": "2030-12-01T14:00:00-06:00", "windowEnd": "2030-12-01T16:00:00-06:00" },
      { "type": "delivery", "locationId": "...", "windowStart": "2030-12-02T14:00:00-06:00", "windowEnd": "2030-12-02T16:00:00-06:00" }
    ]
  }
}
```

- `externalId` is the id of the shipment in your system. **Sending the same `externalId` with the same content again returns the same transport** (`"created": false`), so retries are safe. The same `externalId` with different content is `409 external_id_conflict`: it is never overwritten silently.
- The fields of `transport` are those of `POST /v1/transports` (see `GET /v1/openapi.json` in development). Times need an offset. Weights are in pounds. `quoteId` is not accepted here.
- Several identical calls at once create exactly one transport.
- Errors follow RFC 9457 with a stable `code`; validation problems list the field paths.

## Limits today

- No webhooks (outbound events) yet, no updates of existing transports through the API, no status changes.
- The rate limit is per address and per API instance (see `docs/operations.md`).
- No data is pulled from other systems: Loadlane is called, it does not call out.
