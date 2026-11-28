# Loadlane

B2B SaaS for transport management, United States first. Three pillars: **SEE** (transport visibility), **CALCULATE** (freight calculator, tariffs, quotes) and **EXECUTE** (spot freight: offer, bid, award, track).

Status: phases 1 to 6 are built: sign-in, organizations and roles; master data, transports, documents and an audit trail; Driver Link with consented GPS positions; alerts and a customer tracking link; freight calculator, price lists, quotes with PDF and transports from accepted quotes; spot freight with carrier links, bids and award; reports. Map, ETA, e-mail and the SAP connector are not built yet. See the backlogs in [docs](docs) and [docs/operations.md](docs/operations.md).

## Requirements

- Node.js 26 or newer (`.nvmrc`), pnpm 12 (`corepack enable` picks the pinned version)
- Docker Desktop (local PostgreSQL + PostGIS, Valkey, SeaweedFS)
- A ZITADEL Cloud instance for sign-in: [docs/dev-setup-zitadel.md](docs/dev-setup-zitadel.md)

## Set up

```sh
pnpm install
cp .env.example .env      # then put your own OIDC values into .env
pnpm infra:up             # local services
pnpm infra:check          # all three reachable?
pnpm db:migrate           # apply SQL migrations
```

Start the API and the web app in two terminals:

```sh
pnpm api:start            # http://127.0.0.1:4000, OpenAPI at /v1/openapi.json
pnpm web:dev              # http://localhost:3000
```

If `loadlane_app` cannot log in after an update, run `pnpm infra:reset` once (it deletes the local volumes).

## Checks

Run these after every change; CI runs the same ones.

```sh
pnpm lint
pnpm typecheck
pnpm format:check
pnpm test                 # needs `pnpm infra:up`
```

## Layout

| Path                       | Contents                                                        |
| -------------------------- | --------------------------------------------------------------- |
| `apps/web`                 | Next.js app: sign-in, shell, onboarding, members, settings      |
| `apps/api`                 | NestJS API, one folder per module under `src/modules`           |
| `packages/db`              | Drizzle schema, SQL migrations, `withTenant()`, isolation tests |
| `packages/shared`          | Roles and permissions shared by API and web                     |
| `packages/ui`              | Design tokens and base components                               |
| `infra`                    | Docker Compose for local services                               |
| `docs/adr`                 | Architecture decisions, see the [index](docs/adr/README.md)     |
| `docs/reference/prototype` | Earlier prototype and landing page, design reference only       |

Project rules and conventions for contributors and for Claude Code are in [CLAUDE.md](CLAUDE.md) and [CONTRIBUTING.md](CONTRIBUTING.md). The product scope is in [docs/masterprompt.md](docs/masterprompt.md).
