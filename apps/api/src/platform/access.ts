import { applyDecorators, SetMetadata } from "@nestjs/common";
import { ApiBearerAuth, ApiExtension, ApiHeader } from "@nestjs/swagger";
import type { Permission } from "@loadlane/shared";

/**
 * Every route must declare who may call it (ADR 0010). There are exactly three ways:
 *  - @Public(): anyone, no sign-in (for example the OpenAPI document)
 *  - @AuthenticatedOnly(): any signed-in person, no organization needed (for example /v1/me)
 *  - @RequirePermissions(...): a member of the organization named in X-Organization-Id whose roles
 *    grant all listed permissions
 * A route with none of them is refused at start-up and, as a second line of defense, at request time.
 * The decorators also feed the OpenAPI document, so documentation and enforcement cannot drift apart.
 */
export const ACCESS_KEY = "loadlane:access";

export const ORGANIZATION_HEADER = "x-organization-id";

export type AccessRule =
  | { kind: "public" }
  | { kind: "authenticated" }
  | { kind: "permissions"; permissions: readonly Permission[] };

export const Public = () => SetMetadata(ACCESS_KEY, { kind: "public" } satisfies AccessRule);

export const AuthenticatedOnly = () =>
  applyDecorators(
    SetMetadata(ACCESS_KEY, { kind: "authenticated" } satisfies AccessRule),
    ApiBearerAuth(),
  );

export const RequirePermissions = (...permissions: Permission[]) =>
  applyDecorators(
    SetMetadata(ACCESS_KEY, { kind: "permissions", permissions } satisfies AccessRule),
    ApiBearerAuth(),
    ApiExtension("x-permissions", [...permissions]),
    ApiHeader({
      name: "X-Organization-Id",
      required: true,
      description: "The organization the request acts for. The caller must be an active member.",
      schema: { type: "string", format: "uuid" },
    }),
  );
