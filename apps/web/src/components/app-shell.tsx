import type { ReactNode } from "react";
import { navigationFor } from "../lib/navigation";
import type { ActiveViewer } from "../lib/viewer";
import { Logo } from "./logo";
import { NavLinks } from "./nav-links";
import { OrgSwitcher } from "./org-switcher";
import { UserMenu } from "./user-menu";

/**
 * The frame around every page of an organization: sidebar with the organization switcher, navigation
 * (only the pages the person's roles allow) and the account menu. On narrow screens the sidebar
 * becomes a bar at the top.
 */
export function AppShell({ viewer, children }: { viewer: ActiveViewer; children: ReactNode }) {
  const items = navigationFor(viewer.active.permissions);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[14.5rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-accent px-3 py-2 font-mono text-sm font-semibold text-accent-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <aside className="flex items-center gap-2 overflow-x-auto border-b border-border bg-card px-3 py-2 lg:sticky lg:top-0 lg:h-screen lg:flex-col lg:items-stretch lg:gap-3 lg:overflow-x-visible lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-3 lg:py-4">
        <div className="shrink-0 lg:mb-1">
          <Logo />
        </div>
        <div className="shrink-0">
          <OrgSwitcher
            organizations={viewer.organizations.map(({ id, name }) => ({ id, name }))}
            activeId={viewer.active.id}
          />
        </div>
        <div className="shrink-0 lg:mt-2">
          <NavLinks items={items} />
        </div>
        <div className="ml-auto shrink-0 lg:mt-auto lg:ml-0">
          <UserMenu name={viewer.user.displayName} email={viewer.user.email} />
        </div>
      </aside>
      <main id="main" className="min-w-0 px-4 py-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
