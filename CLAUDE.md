# Loadlane

B2B SaaS for transport management. Three pillars: SEE (transport visibility and tracking), CALCULATE (freight calculator, tariffs, quotes), EXECUTE (spot freight: offer, bid, award, track).
Chain: Calculate -> Offer -> Assign -> Track -> Deliver -> Analyze.
Target market: **United States first.** Full scope and requirements: @docs/masterprompt.md (source of truth for product scope).

## Language
- Talk to the user in **German**.
- Code, identifiers, comments, commits, ADRs and UI copy: **US English**.

## Non-negotiables
1. **Independent development.** Never copy, translate or imitate code, schemas, UI or structure of Fleetbase or any other platform. Do not read competitor repositories as implementation templates. Requirements come from the real logistics use cases.
2. **No fake data as real.** Never invent GPS positions, ETAs, integration results or API endpoints. Mock code is isolated behind a `mock` flag and labeled in code (`// MOCK`) and in the UI.
3. **Tenant isolation on every query.** Every business table has `organization_id` plus PostgreSQL row-level security. Every new table needs a test proving org A cannot see org B.
4. **Permissions on every endpoint and feature.**
5. **Driver privacy.** Show a consent screen before any GPS tracking. Always show the last known position with its timestamp and mark stale data. No hidden tracking.
6. **Money.** Never mix markup (on cost), margin (on price) and absolute contribution. Store them separately. Calculations are immutable snapshots including tariff versions.
7. **Never claim an integration works unless it was tested.**
8. **Ask, do not guess,** on legal, pricing and integration facts.

## Stack
Next.js, React, TypeScript (strict), Tailwind, shadcn/ui, NestJS, PostgreSQL + PostGIS, Drizzle ORM with SQL migrations, Redis + BullMQ, WebSockets, MapLibre, S3-compatible storage, Docker, OpenTelemetry.
Auth: hosted OIDC provider behind our own interface (see docs/adr/0003).
US defaults: miles, pounds, USD, time zone per location, MM/DD/YYYY. Organizations carry a `region` field from day one.

Planned layout: apps/web, apps/api, apps/worker, packages/db, packages/shared, packages/ui, infra/, docs/adr/.

## How to work
1. Plan first. For anything non-trivial write a short plan and wait for approval. Architecture changes need an ADR in `docs/adr/`.
2. Small steps. After every step run lint, typecheck and tests. Do not report done without running them.
3. Check licenses before adding a dependency. MIT, Apache-2.0 and BSD are fine. Ask before GPL, AGPL or SSPL.
4. Small commits with conventional messages. No secrets in the repo, only `.env.example`.
5. Definition of Done: frontend and backend connected, data stored correctly, permissions checked, tenant isolation tested, error cases handled, tests pass, documented, nothing simulated presented as real.

## Commands
TODO: fill in once the repo exists (install, dev, test, lint, db migrate).

## Current phase
Phase 1, see docs/backlog-phase-1.md.
