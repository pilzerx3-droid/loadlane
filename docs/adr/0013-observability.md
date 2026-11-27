# ADR 0013: Observability baseline

Status: Accepted (implemented in backlog P1-10)

## Context

We need to see what the API does, locally now and in production later, without leaking personal data (CLAUDE.md: never log tokens, headers, query values or IP addresses).

## Decisions

1. **Logs:** one structured JSON line per request (pino, ADR 0011). Each line carries `traceId` and `spanId` when tracing is on, so a log line can be matched to its trace.
2. **Traces:** OpenTelemetry (Apache-2.0). `OTEL_TRACES_EXPORTER` is `none` (default), `console` or `otlp`. With `none` nothing is registered and requests pay no cost. With `otlp` the standard `OTEL_EXPORTER_OTLP_*` variables apply, so any OTLP/HTTP collector works; the vendor is a deployment decision.
3. **One server span per request**, created by an Express middleware before any guard, so rejected requests (rate limit, auth) are traced too. The span is named after the route template (`GET /v1/members`), never the concrete URL. Unknown URLs all share one name.
4. **Attributes:** method, route, status code, user id and organization id. Never the query string, headers, tokens, bodies or IP addresses.
5. **Incoming `traceparent` is ignored.** A caller must not choose our trace ids.
6. **No auto-instrumentation yet.** The API is bundled with esbuild, which breaks the monkey-patching that auto-instrumentation relies on. Database and queue spans will be added by hand where they matter.
7. **Metrics and the web app** are not instrumented yet. The web app keeps Next.js telemetry off.

## Consequences

- `@opentelemetry/api` is also a dependency of `packages/db`: `drizzle-orm` has it as an optional peer, and without it pnpm resolves two copies of drizzle with incompatible types.
- Nothing has been tested against a real collector yet; only an in-memory exporter is covered by tests (neither the console nor the OTLP exporter has been exercised).
