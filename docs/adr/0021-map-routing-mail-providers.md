# ADR 0021: Map, routing, geocoding and mail providers

Status: Accepted

## Context

The product needs a map (see where transports are), routing (distance and ETA) and e-mail (send tracking links, carrier invitations and quotes). All three depend on outside services. The budget is free or very cheap, and the application must stay portable (ADR 0016: standards first, providers replaceable).

## Decision

Each capability sits behind a small interface in `packages/shared` or the API platform. A provider is chosen by environment variables, and without configuration the feature says plainly that it is not configured. Nothing is simulated.

| Capability | Interface           | First adapter                                                                                  | Why                                                                                                                                                                                                                            |
| ---------- | ------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Map tiles  | `MAP_STYLE_URL`     | OpenFreeMap style `https://tiles.openfreemap.org/styles/liberty`, rendered with MapLibre GL JS | No key, no stated limits, OSM data. Provided as-is: the URL is configurable so we can self-host or switch. Keep the OSM attribution.                                                                                           |
| Routing    | `RoutingProvider`   | OpenRouteService Directions (`driving-hgv`)                                                    | Free key (about 2,000 Directions/day, 40/min; the figures differ between sources, check the dashboard). Needs `ORS_API_KEY`.                                                                                                   |
| Geocoding  | `GeocodingProvider` | OpenRouteService Pelias geocoder (same key); Nominatim not used by default                     | The public Nominatim instance allows 1 request/second for the whole application and forbids heavy use; it stays an opt-in adapter for low volumes only. Results are stored on the location, so each address is looked up once. |
| E-mail     | `MailProvider`      | SMTP through `nodemailer` (MIT-0 licence, verified on the installed package)                   | SMTP is a standard every provider offers (SES, Postmark, Mailgun, a company relay).                                                                                                                                            |
| Local mail | n/a                 | Mailpit (MIT) in `infra/docker-compose.yml`                                                    | Catches all outgoing mail locally; tests read it through its HTTP API.                                                                                                                                                         |

Rules that follow from the non-negotiables:

- A position, ETA or route is never invented. An ETA exists only when routing returned it from a real last position, and it shows its age and source.
- Calls to outside services never carry driver tokens, capability tokens or personal data beyond what the call needs (coordinates for routing, an address for geocoding).
- Mail bodies and tokens are not stored. A `mail_log` row records who sent what kind of mail to which address and the result.
- Each adapter is tested against a local fake (Mailpit for SMTP, a stub HTTP server for routing and geocoding). We do not claim a live provider works until a real call has been made with a real key.

## Consequences

- The map page needs the CSP to allow the tile host (`connect-src`, `img-src`) and `worker-src blob:`.
- Free tiers can change. Switching provider means changing an adapter or an environment variable, not the data model.
- ORS free quotas limit ETA refresh frequency: ETAs are cached per transport and refreshed at most every few minutes.

## Update 2026-11-28: new host

The old host api.openrouteservice.org answers HTTP 410 since 2026-11-24. The adapters now use https://api.heigit.org (geocoding at /pelias/v1/search, directions at /openrouteservice/v2/directions/driving-hgv/geojson). An existing API key works there. Both adapters were run once against the live service (geocode of a Manhattan address, truck route Chicago to St. Louis) and returned plausible results; the automated tests still use a local stub.
