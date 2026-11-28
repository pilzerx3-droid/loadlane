# ADR 0018: Hosted test environment

Status: **Proposed** (waiting for product owner approval). Number note: 0016 and 0017 were already taken by other decisions, so hosting is 0018.

## Context

The product owner decided that hosted third-party services are welcome when they make the project faster and safer, as long as the application stays on standards so that switching is possible: PostgreSQL (with PostGIS), S3-compatible object storage, Redis-protocol key-value store, OIDC sign-in. ADR 0008 (independent development) is about not copying code, not about hosting.

What the application needs today: a Node web app (Next.js), a Node API (NestJS), PostgreSQL with PostGIS and forced row-level security, a Redis-protocol store (web sessions, later job queues), S3-compatible storage (documents), OIDC (ZITADEL Cloud US, already chosen in ADR 0003). Region: United States (ADR 0005).

## Proposal

| Part                    | Proposed service                                  | Standard it relies on      | Rough cost per month (USD)       |
| ----------------------- | ------------------------------------------------- | -------------------------- | -------------------------------- |
| Web app and API         | Render web services (2)                           | Docker / Node, plain HTTPS | about 14 (two Starter instances) |
| PostgreSQL with PostGIS | Neon (Launch, usage based)                        | PostgreSQL, PostGIS        | about 5 to 20                    |
| Sessions                | Upstash Redis (pay as you go) or Render Key Value | Redis protocol             | 0 to 10                          |
| Document storage        | Cloudflare R2                                     | S3 API                     | 0 to 2 for test data             |
| Sign-in                 | ZITADEL Cloud (existing)                          | OIDC                       | check current plan (ADR 0003)    |

Total for a small test environment: about 20 to 45 USD per month. Prices were read from the providers' pages in November 2026 and some sources disagree; they must be confirmed on the live pricing pages before anyone enters a card.

## Rules for the hosted environment

1. Test data only. The driver consent wording is not yet reviewed by counsel and the position retention job does not exist, so no real drivers or customers are invited.
2. Secrets live in the provider's secret store, never in the repository. Only `.env.example` is committed.
3. The application connects as `loadlane_app` (row-level security), never as the database owner, except for migrations.
4. No vendor SDKs in application code: connection strings and S3 endpoints are configuration.
5. A monthly spending cap or alert is set at every provider before the first deployment.
6. The exit path is tested once: restore a dump into a plain PostgreSQL and run the API against it.

## Open points

- Confirm PostGIS availability and the exact Launch plan limits at Neon, and that Render Starter (512 MB) is enough for Next.js; otherwise the next instance size costs more.
- Confirm that Render Key Value or Upstash speaks the protocol our session client needs.
