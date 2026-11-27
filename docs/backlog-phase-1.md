# Phase 1: Technical foundation

Goal: a secure SaaS base with sign-in, tenants, roles, migrations, tests and CI. No domain features yet.

| ID    | Task                            | Acceptance criteria                                                                                                                                                                        |
| ----- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1-01 | Monorepo scaffold               | pnpm workspaces with apps/web, apps/api, apps/worker, packages/db, packages/shared, packages/ui. TypeScript strict. Lint, format and typecheck scripts run clean.                          |
| P1-02 | Local infrastructure            | `docker compose up` starts PostgreSQL with PostGIS, Redis and MinIO. Health check script confirms all three.                                                                               |
| P1-03 | Database package and migrations | Drizzle schema plus SQL migrations. One command applies migrations to an empty database. CI fails if schema and migrations drift.                                                          |
| P1-04 | Core tables (migration 0001)    | organization (with region and unit defaults), user, membership, role, audit_log. UUID v7 ids, timestamps, foreign keys.                                                                    |
| P1-05 | Tenant context and RLS          | Tenant set per request in the database session. RLS policies on all tenant tables. Test with two organizations proves isolation, including a deliberately wrong query.                     |
| P1-06 | Auth spike and integration      | Compare 2 to 3 OIDC providers against the criteria in ADR 0003 and write the result into the ADR. Implement login in apps/web and token verification in apps/api behind our own interface. |
| P1-07 | Permissions                     | Roles: admin, dispatcher, sales, carrier_user. Guard and decorator for the API, tests for allowed and denied cases.                                                                        |
| P1-08 | API foundation                  | NestJS module skeletons for the modules in the masterprompt, Zod validation, one error format, OpenAPI output, request logging with organization id, basic rate limiting.                  |
| P1-09 | Web shell                       | Next.js with Tailwind and shadcn/ui, design tokens, navigation that follows role permissions, login, organization switcher, empty states. No sample data.                                  |
| P1-10 | Observability baseline          | Structured logs and OpenTelemetry traces locally.                                                                                                                                          |
| P1-11 | CI                              | GitHub Actions: lint, typecheck, tests against a Postgres service, migration check.                                                                                                        |
| P1-12 | Docs                            | README with dev setup, CONTRIBUTING, `.env.example`, ADR index.                                                                                                                            |

## Exit criteria

A user can sign in, belongs to an organization, sees only that organization's data, and the isolation test is part of CI.

## Not in Phase 1

Transports, tracking, calculator, spot freight, integrations. Those follow in Phases 2 to 7.
