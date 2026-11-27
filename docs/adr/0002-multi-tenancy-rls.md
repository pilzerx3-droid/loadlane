# ADR 0002: Multi tenancy rls

Status: Accepted (implemented in migrations 0001 and 0002, backlog P1-04 and P1-05)

## Decision

Every business table has `organization_id`. PostgreSQL row-level security (RLS) is the second line of defense behind the permission checks in the API. Cross-organization work (customer, carrier) happens through `transport_participant` rows with role and visibility scope (Phase 2), never through data copies. A two-organization isolation test is required for every new table.

### Database roles

- **Owner** (`DATABASE_URL`): owns the tables and runs migrations. It is never used to handle requests. In local Docker the owner is a PostgreSQL superuser, and superusers bypass RLS no matter what; in production the owner should not be a superuser.
- **Application role** `loadlane_app` (`APP_DATABASE_URL`): used by the API, the worker and the tests. It is not a superuser, has no `BYPASSRLS`, owns no tables and only has the privileges granted in migrations. Locally, `infra/postgres/init` creates it with a login on first start; migration 0002 creates it without login if it does not exist.

### Tenant context

`withTenant(pool, { organizationId, userId }, fn)` in `packages/db` opens a transaction and sets `app.organization_id` and `app.user_id` with `set_config(..., true)`. The settings are transaction-local, so they cannot leak to the next user of a pooled connection. Both values must be UUIDs. Without a tenant, every tenant table returns zero rows and rejects writes: the locked state is the default.

`withTenant` does not decide who may act for which organization. The caller must have verified the user's membership first (P1-06, P1-07). RLS also cannot protect against SQL injection that calls `set_config` itself; it limits the damage of forgotten `WHERE` clauses and bugs, it does not replace input handling.

### Policies

Every table in schema `public` enables and forces RLS, and its policies apply to `loadlane_app` only. The only exceptions are listed in `rls.test.ts`: `role` (fixed catalog, no customer data, read-only) and PostGIS' `spatial_ref_sys`.

| Table                          | Read                                                                                                       | Write                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `organization`                 | the current tenant, and every organization the current user is an active member of (organization switcher) | insert and update only for the current tenant: a new organization is created by first setting its new id as the tenant |
| `app_user`                     | the person themselves and members of the current tenant                                                    | a person can register and change only their own row                                                                    |
| `membership`                   | the current tenant's rows and the current user's own memberships                                           | inside the current tenant only, no delete (status `removed` instead)                                                   |
| `membership_role`, `audit_log` | the current tenant only                                                                                    | inside the current tenant only; `audit_log` is insert-only                                                             |

Consistency across tables does not rely on RLS alone: `membership_role` references `membership` with a composite key `(membership_id, organization_id)`, so a role assignment can never point to a membership of another organization. Foreign key checks run without RLS, which means a tenant can reference an id it cannot see; composite keys like this one are the answer wherever that matters.

### Rules for new tables

1. Add `organization_id` (not null, foreign key) unless the table is a deliberate catalog.
2. In the same migration: enable and force RLS, add policies `TO loadlane_app`, and grant only the needed privileges.
3. Add rows for two organizations to `rls.test.ts` and prove that organization A cannot read, change or insert organization B's rows. The guard tests there fail when a table in schema `public` has no forced RLS.
4. Read and write through `withTenant`.

## Open questions

- **Audit log retention (legal).** `audit_log` stores `ip` and `user_agent` to investigate security incidents. These are personal data under several US state laws. The retention period and the deletion path (the table is append-only, so a privileged job is needed) are not decided. Clarify with a privacy attorney before the first production launch.
- **Production role setup.** Who creates the login for `loadlane_app` and how its password is managed depends on the hosting decision (infrastructure phase). CI must create the same role as `infra/postgres/init/01-app-role.sh` does (P1-11).
