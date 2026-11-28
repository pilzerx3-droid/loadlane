import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { Button, PageHeader } from "@loadlane/ui";
import { AppShell } from "../../components/app-shell";
import { ForbiddenNotice, Notice } from "../../components/notices";
import { TariffsList } from "../../components/tariff-views";
import { apiRequest } from "../../lib/api-client";
import { getAuthDeps } from "../../lib/deps";
import { tariffListSchema } from "../../lib/tariffs";
import { requireOrganizationPage } from "../../lib/viewer";

export const metadata: Metadata = { title: "Price lists" };
export const dynamic = "force-dynamic";

export default async function TariffsPage() {
  const { viewer, allowed } = await requireOrganizationPage("tariff:read");
  const canManage = viewer.active.permissions.includes("tariff:manage");
  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const list = await apiRequest({
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
      path: "/v1/tariffs?limit=100",
      schema: tariffListSchema,
    });
    content = list.ok ? (
      <TariffsList items={list.data.items} canManage={canManage} />
    ) : (
      <Notice>The price lists could not be loaded right now. Please try again in a moment.</Notice>
    );
  }
  return (
    <AppShell viewer={viewer}>
      <PageHeader
        title="Price lists"
        description="Rates in dated versions that never change"
        actions={
          canManage ? (
            <Button asChild>
              <a href="/tariffs/new">
                <Plus aria-hidden="true" /> New price list
              </a>
            </Button>
          ) : undefined
        }
      />
      {content}
    </AppShell>
  );
}
