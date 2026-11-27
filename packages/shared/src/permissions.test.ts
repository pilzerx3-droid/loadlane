import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  isRoleKey,
  permissionsForRoles,
  type Permission,
  type RoleKey,
} from "./permissions.ts";

describe("role catalog", () => {
  it("has a permission list for every role and nothing else", () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLES].sort());
  });

  it("only grants permissions that exist", () => {
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(PERMISSIONS, `${role} -> ${permission}`).toContain(permission);
      }
    }
  });

  it("gives admin every permission", () => {
    expect([...permissionsForRoles(["admin"])].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("keeps management permissions away from everyone but admin", () => {
    const managing: Permission[] = ["organization:manage", "member:manage", "audit:read"];
    for (const role of ROLES.filter((r) => r !== "admin")) {
      for (const permission of managing) {
        expect(
          permissionsForRoles([role]).has(permission),
          `${role} must not have ${permission}`,
        ).toBe(false);
      }
    }
  });
});

describe("permission matrix", () => {
  // Written out on purpose, independent of ROLE_PERMISSIONS, so a wrong edit there is noticed.
  // Each role gets exactly the permissions listed here and nothing else.
  const granted: Record<RoleKey, Permission[]> = {
    admin: [...PERMISSIONS],
    dispatcher: [
      "organization:read",
      "member:read",
      "customer:read",
      "customer:manage",
      "carrier:read",
      "carrier:manage",
      "location:read",
      "location:manage",
      "transport:read",
      "transport:manage",
    ],
    sales: [
      "organization:read",
      "member:read",
      "customer:read",
      "customer:manage",
      "carrier:read",
      "location:read",
      "location:manage",
      "transport:read",
    ],
    carrier_user: ["organization:read"],
  };

  it.each(ROLES)("%s", (role) => {
    for (const permission of PERMISSIONS) {
      expect(permissionsForRoles([role]).has(permission), `${role} / ${permission}`).toBe(
        granted[role].includes(permission),
      );
    }
  });
});

describe("permissionsForRoles", () => {
  it("adds up the permissions of several roles", () => {
    const granted = permissionsForRoles(["carrier_user", "dispatcher"]);
    expect(granted.has("member:read")).toBe(true);
    expect(granted.has("member:manage")).toBe(false);
  });

  it("grants nothing without roles", () => {
    expect(permissionsForRoles([]).size).toBe(0);
  });

  it("ignores role keys it does not know", () => {
    expect(permissionsForRoles(["superuser", "ADMIN", ""]).size).toBe(0);
  });

  it("recognizes role keys", () => {
    expect(isRoleKey("sales")).toBe(true);
    expect(isRoleKey("Sales")).toBe(false);
  });
});
