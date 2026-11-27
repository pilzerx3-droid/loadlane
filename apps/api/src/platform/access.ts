import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@loadlane/shared";
import type { AuthContext, AuthenticatedRequest } from "../auth/authenticator.ts";

/**
 * Every route must declare who may call it (ADR 0010). There are exactly two ways:
 *  - @AuthenticatedOnly(): any signed-in person, no organization needed (for example /v1/me)
 *  - @RequirePermissions(...): a member of the organization named in X-Organization-Id whose roles
 *    grant all listed permissions
 * A route with neither is refused at start-up and, as a second line of defense, at request time.
 */
export const ACCESS_KEY = "loadlane:access";

export type AccessRule =
  { kind: "authenticated" } | { kind: "permissions"; permissions: readonly Permission[] };

export const AuthenticatedOnly = () =>
  SetMetadata(ACCESS_KEY, { kind: "authenticated" } satisfies AccessRule);

export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(ACCESS_KEY, { kind: "permissions", permissions } satisfies AccessRule);

/** The organization a request acts for, with what the caller's roles allow there. */
export interface TenantAccess {
  organizationId: string;
  roles: readonly string[];
  permissions: ReadonlySet<Permission>;
}

export type TenantRequest = AuthenticatedRequest & { tenant?: TenantAccess };

/** For handlers behind @RequirePermissions: the guard has set both values by then. */
export function requireTenant(request: TenantRequest): { auth: AuthContext; tenant: TenantAccess } {
  if (!request.auth || !request.tenant) {
    throw new Error("Route is missing @RequirePermissions: no tenant on the request");
  }
  return { auth: request.auth, tenant: request.tenant };
}

export const ORGANIZATION_HEADER = "x-organization-id";
