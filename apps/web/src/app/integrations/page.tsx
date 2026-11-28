import type { Metadata } from "next";
import { PageHeader } from "@loadlane/ui";
import { ApiKeysView } from "../../components/api-keys-view";
import { AppShell } from "../../components/app-shell";
import { ForbiddenNotice, Notice } from "../../components/notices";
import { apiRequest, organizationDetailSchema } from "../../lib/api-client";
import { keyListSchema } from "../../lib/api-keys";
import { getAuthDeps } from "../../lib/deps";
import { requireOrganizationPage } from "../../lib/viewer";

export const metadata: Metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const { viewer, allowed } = await requireOrganizationPage("integration:manage");
  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const base = {
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
    };
    const [keys, organization] = await Promise.all([
      apiRequest({ ...base, path: "/v1/api-keys", schema: keyListSchema }),
      apiRequest({ ...base, path: "/v1/organization", schema: organizationDetailSchema }),
    ]);
    content = keys.ok ? (
      <ApiKeysView
        keys={keys.data.items}
        timeZone={organization.ok ? organization.data.timezone : "UTC"}
      />
    ) : (
      <Notice>The API keys could not be loaded right now. Please try again in a moment.</Notice>
    );
  }
  return (
    <AppShell viewer={viewer}>
      <PageHeader title="Integrations" description="API keys for ERP, TMS and middleware" />
      {content}
    </AppShell>
  );
}
