import type { Metadata } from "next";
import { PageHeader } from "@loadlane/ui";
import { AppShell } from "../../../components/app-shell";
import { CalculationForm } from "../../../components/calculation-form";
import { ForbiddenNotice, Notice } from "../../../components/notices";
import { apiRequest } from "../../../lib/api-client";
import { getAuthDeps } from "../../../lib/deps";
import { optionListSchema } from "../../../lib/transport-api";
import { requireOrganizationPage } from "../../../lib/viewer";

export const metadata: Metadata = { title: "New calculation" };
export const dynamic = "force-dynamic";

export default async function NewCalculationPage() {
  const { viewer, allowed } = await requireOrganizationPage("calculation:manage");
  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const customers = viewer.active.permissions.includes("customer:read")
      ? await apiRequest({
          apiUrl: getAuthDeps().config.apiUrl,
          accessToken: viewer.accessToken,
          organizationId: viewer.active.id,
          path: "/v1/customers?limit=100",
          schema: optionListSchema,
        })
      : undefined;
    content =
      customers && !customers.ok ? (
        <Notice>The customers could not be loaded right now. Please try again in a moment.</Notice>
      ) : (
        <CalculationForm
          customers={(customers?.data.items ?? []).map((item) => ({
            id: item.id,
            label: item.name,
          }))}
        />
      );
  }
  return (
    <AppShell viewer={viewer}>
      <PageHeader title="New calculation" description="Costs in, price and margin out" />
      {content}
    </AppShell>
  );
}
