// Roles and permissions of Loadlane (ADR 0010). The catalog lives in code, not in the database, so a
// change is reviewed and versioned like any other change. The database only stores which roles a
// member holds (tables role and membership_role, ADR 0002).

/** Keys of the fixed role catalog. Must match the rows of the `role` table (checked by a test in apps/api). */
export const ROLES = ["admin", "dispatcher", "sales", "carrier_user"] as const;
export type RoleKey = (typeof ROLES)[number];

/**
 * Permissions that exist today. Every new module adds its own permissions together with its endpoints
 * (for example `transport:read` in Phase 2), never ahead of them.
 */
export const PERMISSIONS = [
  "organization:read",
  "organization:manage",
  "member:read",
  "member:manage",
  "audit:read",
  "customer:read",
  "customer:manage",
  "carrier:read",
  "carrier:manage",
  "location:read",
  "location:manage",
  "transport:read",
  "transport:manage",
  "document:read",
  "document:manage",
  "calculation:read",
  "calculation:manage",
  "quote:read",
  "quote:manage",
  "spot:read",
  "spot:manage",
  "tariff:read",
  "tariff:manage",
  "report:read",
  "integration:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * What each role may do. A first proposal: it will be refined with the customer interviews.
 * A member can hold several roles; their permissions add up.
 */
export const ROLE_PERMISSIONS: Readonly<Record<RoleKey, readonly Permission[]>> = {
  admin: PERMISSIONS,
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
    "document:read",
    "document:manage",
    "calculation:read",
    "calculation:manage",
    "quote:read",
    "spot:read",
    "spot:manage",
    "tariff:read",
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
    "document:read",
    "calculation:read",
    "calculation:manage",
    "quote:read",
    "quote:manage",
    "spot:read",
    "tariff:read",
    "tariff:manage",
    "report:read",
  ],
  carrier_user: ["organization:read"],
};

export function isRoleKey(value: string): value is RoleKey {
  return (ROLES as readonly string[]).includes(value);
}

/** The permissions a member gets from their roles. Unknown role keys grant nothing. */
export function permissionsForRoles(roles: readonly string[]): ReadonlySet<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    if (!isRoleKey(role)) continue;
    for (const permission of ROLE_PERMISSIONS[role]) granted.add(permission);
  }
  return granted;
}
