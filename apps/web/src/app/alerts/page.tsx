import type { Metadata } from "next";
import { PageHeader } from "@loadlane/ui";
import { AlertsList, alertListSchema } from "../../components/alerts-list";
import { AppShell } from "../../components/app-shell";
import { ForbiddenNotice, Notice } from "../../components/notices";
import { apiRequest, organizationDetailSchema } from "../../lib/api-client";
import { getAuthDeps } from "../../lib/deps";
import { requireOrganizationPage } from "../../lib/viewer";

export const metadata: Metadata = { title: "Alerts" };
export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const { viewer, allowed } = await requireOrganizationPage("transport:read");
  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const base = {
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
    };
    const [alerts, organization] = await Promise.all([
      apiRequest({ ...base, path: "/v1/transports/alerts", schema: alertListSchema }),
      apiRequest({ ...base, path: "/v1/organization", schema: organizationDetailSchema }),
    ]);
    content = alerts.ok ? (
      <AlertsList
        items={alerts.data.items}
        timeZone={organization.ok ? organization.data.timezone : "UTC"}
      />
    ) : (
      <Notice>The alerts could not be loaded right now. Please try again in a moment.</Notice>
    );
  }
  return (
    <AppShell viewer={viewer}>
      <PageHeader
        title="Alerts"
        description="Transports that need attention, from planned windows and received positions"
      />
      {content}
    </AppShell>
  );
}
