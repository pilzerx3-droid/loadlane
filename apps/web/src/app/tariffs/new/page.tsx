import type { Metadata } from "next";
import { PageHeader } from "@loadlane/ui";
import { AppShell } from "../../../components/app-shell";
import { ForbiddenNotice, Notice } from "../../../components/notices";
import { TariffForm } from "../../../components/tariff-form";
import { apiRequest } from "../../../lib/api-client";
import { getAuthDeps } from "../../../lib/deps";
import { emptyTariffForm } from "../../../lib/tariff-form";
import { optionListSchema } from "../../../lib/transport-api";
import { requireOrganizationPage } from "../../../lib/viewer";

export const metadata: Metadata = { title: "New price list" };
export const dynamic = "force-dynamic";

export default async function NewTariffPage() {
  const { viewer, allowed } = await requireOrganizationPage("tariff:manage");
  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const base = {
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
    };
    const [customers, carriers] = await Promise.all([
      viewer.active.permissions.includes("customer:read")
        ? apiRequest({ ...base, path: "/v1/customers?limit=100", schema: optionListSchema })
        : undefined,
      viewer.active.permissions.includes("carrier:read")
        ? apiRequest({ ...base, path: "/v1/carriers?limit=100", schema: optionListSchema })
        : undefined,
    ]);
    const options = (result: typeof customers) =>
      (result?.ok ? result.data.items : []).map((item) => ({ id: item.id, label: item.name }));
    content =
      (customers && !customers.ok) || (carriers && !carriers.ok) ? (
        <Notice>The customers or carriers could not be loaded right now. Please try again.</Notice>
      ) : (
        <TariffForm
          tariffId=""
          initial={emptyTariffForm(new Date().toISOString().slice(0, 10))}
          customers={options(customers)}
          carriers={options(carriers)}
        />
      );
  }
  return (
    <AppShell viewer={viewer}>
      <PageHeader
        title="New price list"
        description="Rates per mile, pallet, pound, hour or shipment"
      />
      {content}
    </AppShell>
  );
}
