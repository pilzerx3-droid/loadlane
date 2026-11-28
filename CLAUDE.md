# Loadlane

B2B SaaS for transport management. Three pillars: SEE (transport visibility and tracking), CALCULATE (freight calculator, tariffs, quotes), EXECUTE (spot freight: offer, bid, award, track).
Chain: Calculate -> Offer -> Assign -> Track -> Deliver -> Analyze.
Target market: **United States first.** Full scope and requirements: @docs/masterprompt.md (source of truth for product scope).
Precedence: the masterprompt was written EU-first. Where it conflicts with this file or an ADR on region, units, currency, documents (no CMR), privacy law or auth provider, this file and the ADRs win.

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

Requires Node 26+, pnpm 12, Docker Desktop. Copy `.env.example` to `.env` first.

- `pnpm install`: install all workspace dependencies
- `pnpm lint` / `pnpm typecheck` / `pnpm format:check` / `pnpm test`: run after every step
- `pnpm format`: apply Prettier
- `pnpm infra:up` / `infra:down` / `infra:reset` (deletes volumes) / `infra:logs`: local PostGIS, Valkey, SeaweedFS
- `pnpm infra:check`: verify all three services are reachable
- `pnpm db:migrate`: apply SQL migrations from `packages/db/migrations`
- `pnpm db:generate`: generate a migration from schema changes (rename it, review the SQL)
- `pnpm db:check`: fail on schema/migration drift (needs migrations committed)
- `pnpm api:start`: build and start the API on port 4000 (needs the OIDC settings, see docs/dev-setup-zitadel.md)
- `pnpm web:dev`: start the web app on port 3000
- `pnpm worker:start`: start the background worker (daily deletion of old driver positions, needs `APP_DATABASE_URL`)

Tenant isolation (ADR 0002): application code reads and writes only through `withTenant()` from `@loadlane/db`, connected as `loadlane_app` (`APP_DATABASE_URL`). Never use the owner connection (`DATABASE_URL`) outside migrations and test setup. Every new table needs forced RLS, policies, minimal grants and a two-organization test in `packages/db/src/rls.test.ts`. After pulling P1-05, run `pnpm infra:reset` once: it recreates the local volumes so the `loadlane_app` login is created.

Sign-in (ADR 0003): ZITADEL Cloud (US) through standard OIDC only, no vendor SDK. The API verifies JWT access tokens behind `TokenVerifier`; people are identified by (issuer, subject), never linked by e-mail. The web app keeps sessions server-side in Valkey. NestJS code uses explicit `@Inject(token)` because the toolchain does not emit decorator metadata. Packages under `packages/*` must have no side effects on import (the API bundles them).

Permissions (ADR 0010): every API route declares `@Public()`, `@AuthenticatedOnly()` or `@RequirePermissions(...)`; a route without one stops the app from starting. The organization of a request comes from the `X-Organization-Id` header. Roles and the role-to-permission map live in `packages/shared/src/permissions.ts`; a new permission is added together with its endpoint and a test of the role matrix in `apps/api/src/modules/users-permissions/access.e2e.test.ts`. Read the caller's organization and roles with `requireTenant(request)`.

API structure (ADR 0011): code lives in `apps/api/src/modules/<name>/`, cross-cutting code in `apps/api/src/platform/`. A module imports another module only through its `index.ts`; the platform never imports a module (`architecture.test.ts` enforces this). Errors are RFC 9457 problem documents with a stable `code`; clients branch on `code`. Validate input with `ZodPipe(schema)` and document a route with `@ApiRoute({ summary, response, query })`, both from the same Zod schemas. Never log tokens, headers, query values or IP addresses. `pnpm install` must keep `@scarf/scarf` denied in `pnpm-workspace.yaml` (it sends install analytics).

Transports (ADR 0014): master data (customers, carriers, locations) and transports live in `apps/api/src/modules/{customers,carriers,locations,transport-orders}`. The status model is defined once in `packages/shared/src/transport-status.ts`. Times are typed and shown in the time zone of each stop's location (`packages/shared/src/time.ts`). Status changes go only through `POST /v1/transports/:id/status`, which writes the immutable event. Documents go through the API into S3-compatible storage; tests use `MemoryObjectStorage` (MOCK) and the S3 adapter is tested against the local SeaweedFS in `object-storage.e2e.test.ts` (skipped without `S3_ENDPOINT`).

Web shell (ADR 0012): navigation lists only pages that exist and filters by permission (`apps/web/src/lib/navigation.ts`); the active organization is stored in the server session; people create their own organization at `/onboarding` (limit `MAX_ORGANIZATIONS_PER_USER`). UI components live in `packages/ui` with tokens from `docs/reference/prototype`. Fonts are self-hosted; never add a Google Fonts link.

Driver Link (ADR 0015): drivers use a capability link (/d/<token> in the web app, X-Driver-Token header on /v1/driver/*); only the SHA-256 hash of the token is stored, and the API resolves it with withTenant({ driverTokenHash }). No position is accepted without recorded consent (consent_required); positions are append-only events plus last_position; age and plausibility rules live in packages/shared/src/position.ts and the consent text in driver-consent.ts (change the wording = raise CONSENT_TEXT_VERSION). Never put a driver token in a log, audit entry or URL we call.

Notes: TypeScript is pinned to 6.0.x until typescript-eslint supports 7.x. Tests in `packages/db`, `apps/api` and `apps/web` need the local stack running. Local stack uses Valkey (BSD-3) instead of Redis and SeaweedFS (Apache-2.0) instead of MinIO for license reasons.

Commercial modules (ADR 0007, 0016 to 0019): money is whole cents and rates are basis points everywhere (`packages/shared/src/money.ts`); markup, margin and contribution are separate and never converted. A calculation is a frozen snapshot (`calculation`, never updated) and records the tariff versions it used. Quotes copy the price of one calculation, follow `quote-status.ts`, expire by date (derived) and can create one transport once accepted (`quote.transport_id`). Tariffs are immutable dated versions (`tariff_version`); `applyTariff` in `packages/shared` turns a version plus quantities into cost lines and never guesses a missing quantity. Spot freight (`spot_tender`, `spot_invitation`, `spot_bid`) offers an existing transport to chosen carriers through capability links (`X-Spot-Token`, `/s/<token>`); awarding is always a human decision and moves the transport to assigned through the normal history. Customer tracking links (`X-Tracking-Token`, `/t/<token>`) never show a driver position. Reports (`/v1/reports/commercial`) are computed from stored data only. The worker (`pnpm worker:start`) deletes old driver positions. Operations, backups and the pre-launch checklist are in `docs/operations.md`.

## Current phase

Phases 1 to 6 are built (see `docs/backlog-phase-*.md`). Open: map, ETA and e-mail (need provider decisions), SAP connector (needs a test system; ADR 0009), legal texts and retention periods (product owner), hosted environment (ADR 0018, deferred), shared rate-limit store, partner API keys and webhooks.
