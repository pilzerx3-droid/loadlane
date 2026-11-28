# Operations guide

How to run, back up and check Loadlane. Written for the day a hosted environment exists (see ADR 0018); everything here also works locally.

## The four processes

| Process              | Command (local)     | Image target | Port             | Health                                                                |
| -------------------- | ------------------- | ------------ | ---------------- | --------------------------------------------------------------------- |
| API                  | `pnpm api:start`    | `api`        | 4000             | `GET /v1/health` (alive), `GET /v1/health/ready` (database reachable) |
| Web                  | `pnpm web:dev`      | `web`        | 3000             | the sign-in page answers                                              |
| Worker               | `pnpm worker:start` | `worker`     | none             | logs "retention finished" once a day                                  |
| Database, Valkey, S3 | `pnpm infra:up`     | (services)   | 5432, 6379, 8333 | `pnpm infra:check`                                                    |

Images (the API image was built and run on 2026-11-28: it started as the unprivileged `node` user, reached the database and reported healthy; about 390 MB, the web and worker targets were not run): `docker build -f infra/docker/Dockerfile --target <api|web|worker> -t loadlane-<name> .` No secret is part of an image; every setting is an environment variable (see `.env.example`).

## Settings that must be set in production

- `DATABASE_URL`: the owner role. Used **only** to run migrations (`pnpm db:migrate`), never by a running process.
- `APP_DATABASE_URL`: the `loadlane_app` role. This is what the API and the worker use. Row-level security protects every tenant table for this role.
- `OIDC_ISSUER`, `OIDC_AUDIENCE`, and the web app's OIDC client settings (see `docs/dev-setup-zitadel.md`).
- `S3_ENDPOINT`, `S3_BUCKET` and its keys: documents (the API answers 503 `storage_not_configured` without them).
- Valkey/Redis URL for web sessions.
- Run the API behind HTTPS. Behind a proxy tell Express to trust it, otherwise the per-address rate limit sees one client (see `platform/rate-limit.ts`). Set `RATE_LIMIT_REDIS_URL` when more than one API instance runs.

## Deploy order

1. Take a backup (below).
2. `pnpm db:migrate` with the owner role. Migrations are forward-only SQL files in `packages/db/migrations`.
3. Start or restart the API, then the web app, then the worker.
4. Check `GET /v1/health/ready` and sign in.

## Backup and restore (PostgreSQL)

Backups contain personal data (driver positions, names, e-mail addresses): store them encrypted and delete old ones on the same schedule as the retention rules.

```powershell
# Backup (custom format, compressed). Use the owner connection string.
pg_dump --format=custom --file=loadlane-backup.dump "$env:DATABASE_URL"

# Restore into an EMPTY database, then run migrations to be sure nothing is missing.
createdb loadlane_restore
pg_restore --no-owner --dbname=loadlane_restore loadlane-backup.dump
```

Documents (S3 bucket) are backed up separately: enable versioning or replication at the storage provider. A database backup without its documents restores rows whose files are missing.

**Rehearsed on 2026-11-28 (local stack):** `pg_dump --format=custom` of the development database, `pg_restore --no-owner` into an empty database. The copy had the same organizations, all 26 tables with forced row-level security and all 17 migrations recorded. A hosted environment needs its own rehearsal.

**A restore must be rehearsed before it is needed.** Rehearsal checklist: restore into a scratch database, point a local API at it, sign in, open a transport with a document and a driver link, run `pnpm db:check` against it.

## Retention and deletion

- Driver positions are deleted `organization.position_retention_days` (default 30, not yet legally confirmed) after a transport is finished, by the worker, once a day.
- Soft-deleted documents keep their stored file (ADR 0014); the retention period for files is an open legal item.
- Audit entries are append-only and are not deleted by the application.
- The database owner can still read everything: restrict who has that connection string.

## Security checklist before real users

- [ ] Consent wording for drivers and the wording carriers see before bidding reviewed by counsel.
- [ ] Retention period for positions confirmed, documents and audit retention decided.
- [ ] `DATABASE_URL` (owner) is not available to the running processes.
- [ ] HTTPS everywhere; HSTS is already sent by the API and the web app.
- [x] Content Security Policy for the web app: scripts need a per-response nonce (src/proxy.ts), checked in a production build in a real browser on 2026-11-28; styles still allow inline because Tailwind and Next emit style attributes.
- [x] Rate limit shared between API instances: set RATE_LIMIT_REDIS_URL. Verified on 2026-11-28 with two API processes and a local Valkey (5 allowed, then 429 across both). Without it each instance counts alone.
- [ ] Spending alerts at every hosted provider (ADR 0018).
- [ ] Backup rehearsal done and written down with the date.
- [ ] A person is named who receives alerts and can restore.

## What the API does for security today

Every route declares who may call it and the application refuses to start otherwise (ADR 0010). Row-level security isolates tenants in the database (ADR 0002). Capability links (driver, customer tracking, carrier offer) store only a hash of their token and answer 404 or 410 without revealing more. The API sends `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a closed `Content-Security-Policy`, `Cache-Control: no-store` and HSTS over HTTPS, and does not reveal the framework. Tokens, headers, query values and IP addresses are never logged.
