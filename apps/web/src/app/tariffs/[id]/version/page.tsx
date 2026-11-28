import type { Metadata } from "next";
import { PageHeader } from "@loadlane/ui";
import { AppShell } from "../../../../components/app-shell";
import { ForbiddenNotice, Notice } from "../../../../components/notices";
import { TariffForm } from "../../../../components/tariff-form";
import { apiRequest } from "../../../../lib/api-client";
import { getAuthDeps } from "../../../../lib/deps";
import type { TariffFormValues } from "../../../../lib/tariff-form";
import { tariffDetailSchema } from "../../../../lib/tariffs";
import { requireOrganizationPage } from "../../../../lib/viewer";

export const metadata: Metadata = { title: "New version" };
export const dynamic = "force-dynamic";

/** A new version starts from the rates in force today, so only the changes need typing. */
export default async function NewVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer, allowed } = await requireOrganizationPage("tariff:manage");
  let title = "New version";
  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const tariff = await apiRequest({
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
      path: `/v1/tariffs/${encodeURIComponent(id)}`,
      schema: tariffDetailSchema,
    });
    if (!tariff.ok) {
      content = <Notice>This price list does not exist or could not be loaded.</Notice>;
    } else {
      title = `New version of ${tariff.data.name}`;
      const base = tariff.data.currentVersion ?? tariff.data.allVersions[0];
      const dollars = (cents: number) => (cents / 100).toFixed(2);
      const initial: TariffFormValues = {
        name: tariff.data.name,
        kind: tariff.data.kind,
        partyId: tariff.data.party?.id ?? "",
        validFrom: new Date().toISOString().slice(0, 10),
        note: "",
        lines: (base?.lines ?? []).map((line) => ({
          kind: line.kind as TariffFormValues["lines"][number]["kind"],
          label: line.label,
          unit: line.unit as TariffFormValues["lines"][number]["unit"],
          rate: dollars(line.rateCents),
          minimum: line.minimumCents === null ? "" : dollars(line.minimumCents),
        })),
      };
      content = <TariffForm tariffId={id} initial={initial} customers={[]} carriers={[]} />;
    }
  }
  return (
    <AppShell viewer={viewer}>
      <PageHeader
        title={title}
        description="Saved as a new version; older versions stay as they were"
      />
      {content}
    </AppShell>
  );
}
