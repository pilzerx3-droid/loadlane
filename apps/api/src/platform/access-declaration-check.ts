import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { DiscoveryService, Reflector } from "@nestjs/core";
import { discoverRoutes } from "./routes.ts";

/**
 * Stops the application from starting when a route has no access rule (default deny, ADR 0010).
 * The request-time check in AccessGuard remains as a second line of defense.
 */
@Injectable()
export class AccessDeclarationCheck implements OnApplicationBootstrap {
  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const undeclared = discoverRoutes(this.discovery, this.reflector)
      .filter((route) => !route.rule)
      .map((route) => route.name);
    if (undeclared.length > 0) {
      throw new Error(
        `Routes without an access declaration (use @Public(), @AuthenticatedOnly() or @RequirePermissions(...)): ${undeclared.join(", ")}`,
      );
    }
  }
}
