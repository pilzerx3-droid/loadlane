# ADR 0011: API foundation

Status: Accepted (implemented in backlog P1-08)

## Decision

**Structure.** The API is one deployable (ADR 0001) made of modules. `apps/api/src/modules/<name>/` holds one folder per module of the masterprompt (22 in total). Three have code today (`authentication`, `organizations`, `users-permissions`), the others are empty `@Module({})` skeletons that name their phase. A module uses another module only through that module's `index.ts`; the cross-cutting code in `apps/api/src/platform/` never depends on a module. `architecture.test.ts` enforces both rules. `app.module.ts` is the composition root; it decides the order of the global guards.

**One error format.** Every error is an RFC 9457 problem document (`application/problem+json`): `type` (`urn:loadlane:problem:<code>`), `title`, `status`, `detail`, `instance` (request path), plus our `code` (stable, for programs) and `requestId`. Validation errors add `errors: [{ path, message, code }]`. Unexpected errors become a neutral 500 without internals. Clients branch on `code`, never on `detail`.

**Validation with Zod.** `ZodPipe(schema)` validates and converts query, params or body and answers 400 `validation_failed` with field errors. The same schema feeds the OpenAPI document (`ApiRoute`). `nestjs-zod` was not used because its published peer range stops at NestJS 11.

**OpenAPI 3.1** at `GET /v1/openapi.json`, built by `@nestjs/swagger` from the route decorators. Access rules (`@RequirePermissions`, `@AuthenticatedOnly`) add security, the `X-Organization-Id` header and `x-permissions` to the document, so documentation and enforcement come from the same declaration. The shared error responses are added to every route. The document is served unless `NODE_ENV=production` (override with `OPENAPI_ENABLED`). `@nestjs/swagger` pulls in `@scarf/scarf`, whose install script sends usage data to a third party; that script is explicitly denied in `pnpm-workspace.yaml`.

**Request logging** with pino (`nestjs-pino`): one JSON line per request with request id, method, path (never the query string), status, duration, and user and organization id once known. Every other log line written during a request carries the request id as well. Never logged: tokens, headers, cookies, query values, bodies, IP addresses. The request id is taken from `X-Request-Id` when it matches `[A-Za-z0-9._-]{1,128}`, otherwise generated, and always returned in the response. Log lines also contain pino's default `pid` and `hostname`.

**Rate limiting** with `@nestjs/throttler`: 120 requests per minute per client address across the whole API (`RATE_LIMIT_PER_MINUTE`). It runs before authentication so that requests with invalid tokens are limited, too. The library counts per route by default; `RateLimitGuard` changes that to one counter per client. Answer: 429 `rate_limited` with `Retry-After`.

## Consequences and open points

- Counters live in memory: correct for one instance only. Several instances need a shared store (Valkey). The ready-made Redis storage package supports only NestJS up to 11, so a small own storage on ioredis is the likely route.
- Behind a reverse proxy Express must trust the proxy (`trust proxy`), otherwise all clients share one address. To be configured with the deployment (Phase 8).
- No per-user limit after sign-in yet, and no stricter limit for sensitive routes.
- A list convention exists only for `/v1/members` (`limit`, `offset`, `page.total`). Cursor paging may be needed for large lists (transports, positions).
- The API version is part of the path (`/v1`). A policy for breaking changes and for how long the OpenAPI document of an old version stays available is still to be written.
- Time zone and unit conventions of request and response bodies are not defined yet; they follow the organization settings (ADR 0005) and are decided with the first domain endpoints.
