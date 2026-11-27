import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { METHOD_METADATA } from "@nestjs/common/constants";
import { DiscoveryService, Reflector } from "@nestjs/core";
import { ACCESS_KEY, type AccessRule } from "./access.ts";

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
    const undeclared: string[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      // Nest types the instance as any; look at it as unknown.
      const instance: unknown = wrapper.instance;
      const metatype = wrapper.metatype;
      if (typeof instance !== "object" || instance === null || typeof metatype !== "function") {
        continue;
      }
      const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        // Only methods that Nest routes (@Get, @Post, ...) carry the method metadata.
        if (typeof handler !== "function" || !Reflect.hasMetadata(METHOD_METADATA, handler))
          continue;
        const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, [
          handler,
          metatype,
        ]);
        if (!rule) undeclared.push(`${metatype.name}.${name}`);
      }
    }
    if (undeclared.length > 0) {
      throw new Error(
        `Routes without an access declaration (use @AuthenticatedOnly() or @RequirePermissions(...)): ${undeclared.join(", ")}`,
      );
    }
  }
}
