# Contributing

Read [CLAUDE.md](CLAUDE.md) first. It holds the non-negotiable rules; this file is the short practical version.

## Workflow

1. Plan non-trivial work in a few lines before coding. Architecture changes need an ADR in `docs/adr/` (add it to the [index](docs/adr/README.md)).
2. Work in small steps. After every step run `pnpm lint`, `pnpm typecheck`, `pnpm format:check` and `pnpm test`.
3. Commit small, with conventional messages (`feat(api): ...`, `fix(db): ...`, `docs: ...`). No secrets in the repository; only `.env.example` is committed.
4. Open a pull request against `main`. CI must be green.

## Rules that are checked

- **Tenant isolation.** Application code reads and writes only through `withTenant()`. A new business table needs `organization_id`, forced row-level security, policies, minimal grants and a two-organization test in `packages/db/src/rls.test.ts`.
- **Permissions.** Every API route declares `@Public()`, `@AuthenticatedOnly()` or `@RequirePermissions(...)`; the app refuses to start otherwise. A new permission comes with its endpoint and a role-matrix test.
- **Module boundaries.** A module imports another module only through its `index.ts`; `architecture.test.ts` enforces it.
- **No fake data as real.** Mock code sits behind a `mock` flag, is marked `// MOCK` and is labeled in the UI.
- **Dependencies.** Check the license first. MIT, Apache-2.0 and BSD are fine; ask before GPL, AGPL or SSPL.
- **Privacy.** Never log tokens, headers, query values or IP addresses. Show consent before any GPS tracking.

## Language

Code, comments, commits, ADRs and UI copy are US English.

## Migrations

Change the Drizzle schema, run `pnpm db:generate`, rename the migration, review the SQL, then run `pnpm db:migrate` and `pnpm db:check`.
