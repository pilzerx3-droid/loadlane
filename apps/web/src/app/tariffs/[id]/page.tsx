import type { Metadata } from "next";
import { PageHeader } from "@loadlane/ui";
import { AppShell } from "../../../components/app-shell";
import { ForbiddenNotice, Notice } from "../../../components/notices";
import { TariffDetailView } from "../../../components/tariff-views";
import { apiRequest } from "../../../lib/api-client";
import { getAuthDeps } from "../../../lib/deps";
import { tariffDetailSchema } from "../../../lib/tariffs";
import { requireOrganizationPage } from "../../../lib/viewer";

export const metadata: Metadata = { title: "Price list" };
export const dynamic = "force-dynamic";

export default async function TariffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer, allowed } = await requireOrganizationPage("tariff:read");
  const canManage = viewer.active.permissions.includes("tariff:manage");
  let title = "Price list";
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
    if (tariff.ok) {
      title = tariff.data.name;
      content = <TariffDetailView tariff={tariff.data} canManage={canManage} />;
    } else {
      content = (
        <Notice>
          {tariff.status === 404 || tariff.status === 400
            ? "This price list does not exist."
            : "The price list could not be loaded right now. Please try again in a moment."}{" "}
          <a href="/tariffs" className="underline">
            Back to all price lists
          </a>
        </Notice>
      );
    }
  }
  return (
    <AppShell viewer={viewer}>
      <PageHeader title={title} />
      {content}
    </AppShell>
  );
}
