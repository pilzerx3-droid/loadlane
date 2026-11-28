"use client";

import {
  AlertTriangle,
  Building2,
  Calculator,
  History,
  LayoutDashboard,
  MapPin,
  Package,
  Settings,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { cn } from "@loadlane/ui";
import { isActive, type NavIcon, type NavItem } from "../lib/navigation";

const ICONS: Record<NavIcon, LucideIcon> = {
  overview: LayoutDashboard,
  activity: History,
  alerts: AlertTriangle,
  calculator: Calculator,
  transports: Package,
  customers: Building2,
  carriers: Truck,
  locations: MapPin,
  members: Users,
  settings: Settings,
};

/** The sidebar navigation. The link of the current page is marked with aria-current. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex items-center gap-1 lg:flex-col lg:items-stretch">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const current = isActive(item.href, pathname);
        return (
          <a
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-control px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground",
              current && "bg-muted text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
