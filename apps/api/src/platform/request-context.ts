import type { Permission } from "@loadlane/shared";
import type { Request } from "express";

/** Who is calling. Set on the request once the access token has been verified. */
export interface AuthContext {
  user: { id: string; email: string; displayName: string };
  issuer: string;
  subject: string;
}

export type AuthenticatedRequest = Request & { auth?: AuthContext };

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
