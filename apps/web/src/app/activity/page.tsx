import type { Metadata } from "next";
import { PageHeader } from "@loadlane/ui";
import { ActivityList, auditListSchema } from "../../components/activity-list";
import { AppShell } from "../../components/app-shell";
import { ForbiddenNotice, Notice } from "../../components/notices";
import { apiRequest, organizationDetailSchema } from "../../lib/api-client";
import { getAuthDeps } from "../../lib/deps";
import { parsePage } from "../../lib/paging";
import { requireOrganizationPage } from "../../lib/viewer";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const KINDS = new Set(["transport", "document", "customer", "carrier", "location"]);

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { viewer, allowed } = await requireOrganizationPage("audit:read");
  const params = await searchParams;
  const page = parsePage(params["page"]);
  const type =
    typeof params["type"] === "string" && KINDS.has(params["type"]) ? params["type"] : "";

  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const base = {
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
    };
    const query = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    });
    if (type) query.set("entityType", type);
    const [audit, organization] = await Promise.all([
      apiRequest({ ...base, path: `/v1/audit?${query.toString()}`, schema: auditListSchema }),
      apiRequest({ ...base, path: "/v1/organization", schema: organizationDetailSchema }),
    ]);
    content = audit.ok ? (
      <ActivityList
        items={audit.data.items}
        total={audit.data.page.total}
        page={page}
        pageSize={PAGE_SIZE}
        entityType={type}
        timeZone={organization.ok ? organization.data.timezone : "UTC"}
      />
    ) : audit.status === 403 ? (
      <ForbiddenNotice />
    ) : (
      <Notice>The activity could not be loaded right now. Please try again in a moment.</Notice>
    );
  }

  return (
    <AppShell viewer={viewer}>
      <PageHeader title="Activity" description="Who changed what, and when" />
      {content}
    </AppShell>
  );
}
