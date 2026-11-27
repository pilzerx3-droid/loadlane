# ADR 0010: Roles and permissions

Status: Accepted (implemented in backlog P1-07)

## Decision

- **Roles** are `admin`, `dispatcher`, `sales` and `carrier_user`. They are stored per membership (tables `role` and `membership_role`, ADR 0002). A member can hold several roles in an organization; their permissions add up. A role applies only in the organization where it is held.
- **Permissions** are named `<area>:<action>`, for example `member:read`. The catalog and the map from role to permissions live in code (`packages/shared/src/permissions.ts`), so changes are reviewed and versioned. A test checks that the `role` table and the code have the same roles. A permission is added together with the endpoint that uses it, never ahead of it.
- **Organization of a request:** the header `X-Organization-Id` (one UUID). Endpoints that need no organization (for example `/v1/me`) do not use it.
- **Every route declares its access** with `@Public()` (anyone, for example the OpenAPI document), `@AuthenticatedOnly()` (any signed-in person) or `@RequirePermissions(...)` (active member whose roles grant all listed permissions). A global guard enforces it. The decorators also feed the OpenAPI document (ADR 0011). **Default deny:** a route without a declaration stops the application from starting (`AccessDeclarationCheck`) and is refused at request time as a second line of defense.
- **Answers, in this order:** 401 not signed in, 400 organization header missing or invalid, 403 `forbidden` when the caller is not an active member of a live organization (the same answer for an unknown organization, so existence is not revealed), 403 `permission_denied` when a permission is missing.
- Roles are read from the database on every request, so a change or a removal takes effect immediately. Row-level security (ADR 0002) stays the second line of defense: the lookup and all queries run with the organization set.

## Consequences

- The role-to-permission map is a first proposal. It is refined after the customer interviews.
- Carrier users and cross-organization visibility (`transport_participant`, Phase 2) will need rules beyond "role in own organization"; this ADR will be extended then.
- Denied requests are only logged. A queryable audit trail of denials comes with the platform-level audit work (see ADR 0003, open questions).
- No caching of memberships yet. Revisit when request volume or latency asks for it.
- The header was chosen over a URL prefix for simplicity. Revisit with the OpenAPI output in P1-08.
