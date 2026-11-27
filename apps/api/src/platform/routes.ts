import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { DiscoveryService, Reflector } from "@nestjs/core";
import { ACCESS_KEY, type AccessRule } from "./access.ts";

export interface DiscoveredRoute {
  /** `ControllerName.handlerName`, for error messages. */
  name: string;
  httpMethod: string;
  /** Full path, for example `/v1/me`. */
  path: string;
  rule: AccessRule | undefined;
}

function joinPaths(...parts: unknown[]): string {
  const segments = parts.flatMap((part): unknown[] =>
    Array.isArray(part) ? (part as unknown[]).slice(0, 1) : [part],
  );
  const joined = segments
    .filter((part): part is string => typeof part === "string" && part !== "" && part !== "/")
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .join("/");
  return `/${joined}`;
}

/** Lists every routed controller method with its access rule. Used by the start-up check and by tests. */
export function discoverRoutes(
  discovery: DiscoveryService,
  reflector: Reflector,
): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  for (const wrapper of discovery.getControllers()) {
    // Nest types the instance as any; look at it as unknown.
    const instance: unknown = wrapper.instance;
    const metatype = wrapper.metatype;
    if (typeof instance !== "object" || instance === null || typeof metatype !== "function")
      continue;

    const controllerPath: unknown = Reflect.getMetadata(PATH_METADATA, metatype);
    const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name];
      // Only methods that Nest routes (@Get, @Post, ...) carry the method metadata.
      if (typeof handler !== "function" || !Reflect.hasMetadata(METHOD_METADATA, handler)) continue;

      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
      const handlerPath: unknown = Reflect.getMetadata(PATH_METADATA, handler);
      routes.push({
        name: `${metatype.name}.${name}`,
        httpMethod: RequestMethod[method].toLowerCase(),
        path: joinPaths(controllerPath, handlerPath),
        rule: reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, [handler, metatype]),
      });
    }
  }
  return routes;
}
