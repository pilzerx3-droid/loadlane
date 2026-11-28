import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { Button, PageHeader } from "@loadlane/ui";
import { AppShell } from "../../components/app-shell";
import { CalculationsList } from "../../components/calculation-views";
import { ForbiddenNotice, Notice } from "../../components/notices";
import { apiRequest, organizationDetailSchema } from "../../lib/api-client";
import { calculationListSchema } from "../../lib/calculations";
import { getAuthDeps } from "../../lib/deps";
import { requireOrganizationPage } from "../../lib/viewer";

export const metadata: Metadata = { title: "Calculator" };
export const dynamic = "force-dynamic";

export default async function CalculationsPage() {
  const { viewer, allowed } = await requireOrganizationPage("calculation:read");
  const canManage = viewer.active.permissions.includes("calculation:manage");
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
      apiRequest({ ...base, path: "/v1/calculations?limit=50", schema: calculationListSchema }),
      apiRequest({ ...base, path: "/v1/organization", schema: organizationDetailSchema }),
    ]);
    content = list.ok ? (
      <CalculationsList
        items={list.data.items}
        timeZone={organization.ok ? organization.data.timezone : "UTC"}
        canManage={canManage}
      />
    ) : (
      <Notice>The calculations could not be loaded right now. Please try again in a moment.</Notice>
    );
  }
  return (
    <AppShell viewer={viewer}>
      <PageHeader
        title="Calculator"
        description="Freight cost and price calculations, frozen when saved"
        actions={
          canManage ? (
            <Button asChild>
              <a href="/calculations/new">
                <Plus aria-hidden="true" /> New calculation
              </a>
            </Button>
          ) : undefined
        }
      />
      {content}
    </AppShell>
  );
}
