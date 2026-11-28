export type NavIcon =
  | "overview"
  | "activity"
  | "alerts"
  | "calculator"
  | "quotes"
  | "spot"
  | "tariffs"
  | "transports"
  | "customers"
  | "carriers"
  | "locations"
  | "members"
  | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** The permission needed to see the entry. Without one, every member sees it. */
  requires?: string;
}

/**
 * Every page of the app that exists. An entry is added together with its page, never ahead of it:
 * the navigation does not show features that are not there yet. The API checks every request again,
 * so hiding an entry is a convenience and not the protection.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/transports", label: "Transports", icon: "transports", requires: "transport:read" },
  { href: "/alerts", label: "Alerts", icon: "alerts", requires: "transport:read" },
  {
    href: "/calculations",
    label: "Calculator",
    icon: "calculator",
    requires: "calculation:read",
  },
  { href: "/tariffs", label: "Price lists", icon: "tariffs", requires: "tariff:read" },
  { href: "/quotes", label: "Quotes", icon: "quotes", requires: "quote:read" },
  { href: "/spot", label: "Spot freight", icon: "spot", requires: "spot:read" },
  { href: "/customers", label: "Customers", icon: "customers", requires: "customer:read" },
  { href: "/carriers", label: "Carriers", icon: "carriers", requires: "carrier:read" },
  { href: "/locations", label: "Locations", icon: "locations", requires: "location:read" },
  { href: "/members", label: "Members", icon: "members", requires: "member:read" },
  { href: "/activity", label: "Activity", icon: "activity", requires: "audit:read" },
  { href: "/settings", label: "Settings", icon: "settings", requires: "organization:read" },
];

export function navigationFor(permissions: readonly string[]): NavItem[] {
  const granted = new Set(permissions);
  return NAV_ITEMS.filter((item) => item.requires === undefined || granted.has(item.requires));
}

/** Whether a link is the page the person is on. The overview matches only the exact root. */
export function isActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
