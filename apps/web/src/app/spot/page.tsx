import type { Metadata } from "next";
import { PageHeader } from "@loadlane/ui";
import { AppShell } from "../../components/app-shell";
import { ForbiddenNotice, Notice } from "../../components/notices";
import { TendersList } from "../../components/spot-views";
import { apiRequest, organizationDetailSchema } from "../../lib/api-client";
import { getAuthDeps } from "../../lib/deps";
import { tenderListSchema } from "../../lib/spot";
import { requireOrganizationPage } from "../../lib/viewer";

export const metadata: Metadata = { title: "Spot freight" };
export const dynamic = "force-dynamic";

export default async function SpotPage() {
  const { viewer, allowed } = await requireOrganizationPage("spot:read");
  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const base = {
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
    };
    const [list, organization] = await Promise.all([
      apiRequest({ ...base, path: "/v1/spot-tenders?limit=50", schema: tenderListSchema }),
      apiRequest({ ...base, path: "/v1/organization", schema: organizationDetailSchema }),
    ]);
    content = list.ok ? (
      <TendersList
        items={list.data.items}
        timeZone={organization.ok ? organization.data.timezone : "UTC"}
      />
    ) : (
      <Notice>The offers could not be loaded right now. Please try again in a moment.</Notice>
    );
  }
  return (
    <AppShell viewer={viewer}>
      <PageHeader
        title="Spot freight"
        description="Offer a load to chosen carriers, compare bids, award"
      />
      {content}
    </AppShell>
  );
}
