# ADR 0018: Hosted test environment, free first

Status: **Proposed** (waiting for product owner approval). Number note: 0016 and 0017 were already taken by other decisions, so hosting is 0018.

## Context

The product owner decided that hosted third-party services are welcome when they make the project faster and safer, as long as the application stays on standards so that switching is possible: PostgreSQL (with PostGIS), S3-compatible object storage, Redis-protocol key-value store, OIDC sign-in. ADR 0008 (independent development) is about not copying code, not about hosting. The product owner also wants to stay free or very cheap until paying is unavoidable or the upside clearly justifies it.

What the application needs today: a Node web app (Next.js), a Node API (NestJS), PostgreSQL with PostGIS and forced row-level security, a Redis-protocol store (web sessions, later job queues), S3-compatible storage (documents), OIDC (ZITADEL Cloud US, ADR 0003). Region: United States (ADR 0005).

## Proposal: two stages

**Stage 0: free test environment (0 USD per month).** Limits as read from the providers' pages in November 2026; sources partly disagree and must be confirmed on the live pages.

| Part                    | Service                      | Free allowance                                                | Catch                                                                           |
| ----------------------- | ---------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Web app and API         | Render free web services (2) | 750 instance hours per month per workspace                    | Sleeps after 15 minutes without traffic; waking takes up to about a minute      |
| PostgreSQL with PostGIS | Neon Free                    | about 1 GB per project, 100 compute hours, scales to zero     | Compute sleeps after 5 minutes (wakes in under a second); limits may suspend it |
| Sessions                | Upstash Redis free           | 500,000 commands per month, 256 MB                            | Enough for a handful of testers                                                 |
| Documents               | Cloudflare R2                | 10 GB stored, 1 million writes, 10 million reads, free egress | A payment method may be required to enable it (unconfirmed)                     |
| Sign-in                 | ZITADEL Cloud Free           | 100 daily active users                                        | Custom domain needs the 100 USD Pro plan                                        |

Render's free Postgres is not used: it expires after 30 days.

**Stage 1: first pilot with real users (about 20 to 45 USD per month).** Render Starter for web and API (about 14), Neon Launch (about 5 to 20), Upstash or Render Key Value (0 to 10), R2 (0 to 2). Moving up is a configuration change, not a rewrite.

## Triggers to leave stage 0 (any one)

- A customer or pilot user depends on it: the one-minute wake-up is not acceptable.
- Neon storage nears 1 GB or compute hours run out.
- More than 100 daily active users sign in, or a custom sign-in domain is needed.
- Backups matter: the free tiers offer no dependable backup for real data.

## Rules for the hosted environment

1. Test data only in stage 0. The driver consent wording is not yet reviewed by counsel and the position retention job does not exist, so no real drivers or customers are invited.
2. Secrets live in the provider's secret store, never in the repository. Only `.env.example` is committed.
3. The application connects as `loadlane_app` (row-level security), never as the database owner, except for migrations.
4. No vendor SDKs in application code: connection strings and S3 endpoints are configuration.
5. A spending alert or cap is set at every provider that can charge, even in stage 0.
6. The exit path is tested once: restore a dump into a plain PostgreSQL and run the API against it.

## Open points

- Confirm PostGIS and the current Free plan limits at Neon, and what Neon's free plan does when a limit is reached.
- Confirm that Upstash speaks the protocol our session client needs.
- Confirm whether R2 needs a card on file.
- Confirm that Render free services may be used for this purpose under their terms.
