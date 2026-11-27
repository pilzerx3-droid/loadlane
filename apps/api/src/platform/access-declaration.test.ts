// Default deny (ADR 0010): a route without an access rule must not be reachable.
import "reflect-metadata";
import { Controller, Get, Module, type ExecutionContext } from "@nestjs/common";
import { DiscoveryModule, NestFactory, Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import type { Authenticator } from "../auth/authenticator.ts";
import { AccessDeclarationCheck } from "./access-declaration-check.ts";
import { AuthenticatedOnly, RequirePermissions } from "./access.ts";
import { AccessGuard } from "./access.guard.ts";
import type { MembershipAccess } from "./membership-access.ts";

@Controller("v1")
class UndeclaredController {
  @Get("declared")
  @AuthenticatedOnly()
  declared(): string {
    return "ok";
  }

  @Get("leak")
  leak(): string {
    return "no rule";
  }
}

@Controller("v1")
@AuthenticatedOnly()
class ClassLevelController {
  @Get("inherits")
  inherits(): string {
    return "rule on the class";
  }
}

@Controller("v1")
class DeclaredController {
  @Get("a")
  @RequirePermissions("organization:read")
  a(): string {
    return "a";
  }

  // Not a route (no @Get): helper methods need no rule.
  helper(): string {
    return "helper";
  }
}

@Module({
  imports: [DiscoveryModule],
  controllers: [UndeclaredController],
  providers: [AccessDeclarationCheck],
})
class BadModule {}

@Module({
  imports: [DiscoveryModule],
  controllers: [ClassLevelController, DeclaredController],
  providers: [AccessDeclarationCheck],
})
class GoodModule {}

describe("start-up check", () => {
  it("refuses to start when a route has no access rule and names the route", async () => {
    const app = await NestFactory.create(BadModule, { logger: false });
    await expect(app.init()).rejects.toThrow(/UndeclaredController\.leak/);
    await app.close();
  });

  it("does not name routes that have a rule", async () => {
    const app = await NestFactory.create(BadModule, { logger: false });
    await expect(app.init()).rejects.not.toThrow(/UndeclaredController\.declared/);
    await app.close();
  });

  it("starts when every route has a rule, on the method or on the class, and ignores helper methods", async () => {
    const app = await NestFactory.create(GoodModule, { logger: false });
    await app.init();
    await app.close();
  });
});

describe("AccessGuard at request time", () => {
  function contextFor(controller: new () => object, method: string): ExecutionContext {
    const handler = (controller.prototype as Record<string, () => unknown>)[method];
    return {
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }), getResponse: () => ({}) }),
    } as unknown as ExecutionContext;
  }

  function guard() {
    const authenticate = vi.fn();
    const authenticator = { authenticate } as unknown as Authenticator;
    const membershipAccess = { load: vi.fn() } as unknown as MembershipAccess;
    return {
      guard: new AccessGuard(new Reflector(), authenticator, membershipAccess),
      authenticate,
    };
  }

  it("refuses a route without a rule before it even looks at the token", async () => {
    const { guard: g, authenticate } = guard();
    await expect(g.canActivate(contextFor(UndeclaredController, "leak"))).rejects.toMatchObject({
      response: { code: "access_not_declared" },
    });
    expect(authenticate).not.toHaveBeenCalled();
  });
});
