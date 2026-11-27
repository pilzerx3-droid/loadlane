# ADR 0012: Web shell, organization switching and onboarding

Status: accepted (P1-09)

## Context

People can sign in (ADR 0003) and the API knows their organizations, roles and permissions (ADR 0010). The web app needs a shell that shows only what a person may use, lets them switch between organizations, and lets a new person create their first organization.

## Decisions

1. **Navigation shows only real pages.** `apps/web/src/lib/navigation.ts` lists Overview, Members (needs `member:read`) and Settings (needs `organization:read`). Planned areas (transports, calculator, spot freight) are not shown until they exist. The API still enforces every permission; hiding a link is convenience only.
2. **The active organization lives in the server-side session** (Valkey), not in a cookie the browser can edit. On every request the web app asks `GET /v1/me` and keeps the remembered organization only if the person still belongs to it; otherwise it falls back to the first one.
3. **Switching and creating are server actions** (`app/actions.ts`). Switching re-checks membership against the API before changing the session.
4. **Self-service organization creation** through `POST /v1/organizations`. The creator becomes admin. A person may create at most `MAX_ORGANIZATIONS_PER_USER` (default 3) organizations to limit abuse. Creation takes an advisory lock per person so parallel requests cannot exceed the limit, and writes an audit entry.
5. **Own role assignments are readable across organizations** (migration 0004, policy `membership_role_select_own`) so `/v1/me` can return roles per organization. This exposes only a person's own rows.
6. **UI components** are written by hand in shadcn style on Radix (`packages/ui`). Tokens come from the design reference in `docs/reference/prototype`. Fonts are self-hosted (Fontsource, SIL OFL); no request goes to Google Fonts.
7. **Honest empty states.** The overview says "No transports yet"; nothing simulated is shown.

## Consequences

- Every web page asks the API once per request for the person's context. A short cache can be added if it becomes a cost.
- The creation limit is a product decision and can be changed through configuration.
