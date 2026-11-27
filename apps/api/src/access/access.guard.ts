import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { permissionsForRoles } from "@loadlane/shared";
import type { Response } from "express";
import type { Authenticator } from "../auth/authenticator.ts";
import { AUTHENTICATOR, MEMBERSHIP_ACCESS } from "../auth/tokens.ts";
import { ACCESS_KEY, ORGANIZATION_HEADER, type AccessRule, type TenantRequest } from "./access.ts";
import type { MembershipAccess } from "./membership-access.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function forbidden(
  code: "forbidden" | "permission_denied" | "access_not_declared",
  message: string,
) {
  return new ForbiddenException({ statusCode: 403, code, message });
}

/** Reads and validates X-Organization-Id. Throws 400 when it is missing, repeated or not a UUID. */
function organizationFromHeader(value: string | string[] | undefined): string {
  if (value === undefined) {
    throw new BadRequestException({
      statusCode: 400,
      code: "organization_required",
      message: `The ${ORGANIZATION_HEADER} header is required for this endpoint`,
    });
  }
  const candidate = Array.isArray(value) ? undefined : value.trim().toLowerCase();
  if (!candidate || !UUID_PATTERN.test(candidate)) {
    throw new BadRequestException({
      statusCode: 400,
      code: "organization_invalid",
      message: `The ${ORGANIZATION_HEADER} header must contain exactly one organization id (UUID)`,
    });
  }
  return candidate;
}

/**
 * Global guard: signs the caller in, then enforces the access rule of the route. Default deny: a route
 * without a rule is refused. Order of answers: 401 (not signed in), 400 (bad organization header),
 * 403 (not an active member, or a permission is missing).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly logger = new Logger(AccessGuard.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AUTHENTICATOR) private readonly authenticator: Authenticator,
    @Inject(MEMBERSHIP_ACCESS) private readonly membershipAccess: MembershipAccess,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) {
      this.logger.error(
        `Refused ${context.getClass().name}.${context.getHandler().name}: no @AuthenticatedOnly() or @RequirePermissions()`,
      );
      throw forbidden("access_not_declared", "This endpoint has no access rule and is refused");
    }

    const http = context.switchToHttp();
    const request = http.getRequest<TenantRequest>();
    const auth = await this.authenticator.authenticate(request, http.getResponse<Response>());
    if (rule.kind === "authenticated") return true;

    const organizationId = organizationFromHeader(request.headers[ORGANIZATION_HEADER]);
    const membership = await this.membershipAccess.load(auth.user.id, organizationId);
    if (!membership) {
      // The same answer for an organization that does not exist and one the caller does not belong to.
      throw forbidden("forbidden", "You are not an active member of this organization");
    }

    const granted = permissionsForRoles(membership.roles);
    const missing = rule.permissions.filter((permission) => !granted.has(permission));
    if (missing.length > 0) {
      this.logger.warn(
        `Permission denied for user ${auth.user.id} in organization ${organizationId}: needs ${missing.join(", ")}`,
      );
      throw forbidden("permission_denied", "You do not have permission for this action");
    }

    request.tenant = { organizationId, roles: membership.roles, permissions: granted };
    return true;
  }
}
