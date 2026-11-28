import type { Metadata } from "next";
import { PageHeader } from "@loadlane/ui";
import { AppShell } from "../../components/app-shell";
import { ForbiddenNotice, Notice } from "../../components/notices";
import { CommercialReportView } from "../../components/report-views";
import { apiRequest } from "../../lib/api-client";
import { getAuthDeps } from "../../lib/deps";
import { PERIODS, commercialReportSchema, periodStart } from "../../lib/reports";
import { requireOrganizationPage } from "../../lib/viewer";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { viewer, allowed } = await requireOrganizationPage("report:read");
  const params = await searchParams;
  const requested = typeof params["period"] === "string" ? params["period"] : "30";
  const period = PERIODS.find((entry) => entry.key === requested) ?? PERIODS[0];
  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    // The API counts whole days in the organization's time zone; "to" defaults to today there.
    const today = new Date().toISOString().slice(0, 10);
    const report = await apiRequest({
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
      path: `/v1/reports/commercial?from=${periodStart(today, period.days)}&to=${today}`,
      schema: commercialReportSchema,
    });
    content = report.ok ? (
      <CommercialReportView report={report.data} selected={period.key} />
    ) : (
      <Notice>The report could not be loaded right now. Please try again in a moment.</Notice>
    );
  }
  return (
    <AppShell viewer={viewer}>
      <PageHeader
        title="Reports"
        description="Spot freight, quotes and deliveries from stored data"
      />
      {content}
    </AppShell>
  );
}
