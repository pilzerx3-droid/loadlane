import type { Metadata } from "next";
import { PageHeader } from "@loadlane/ui";
import { AppShell } from "../../../components/app-shell";
import { ForbiddenNotice, Notice } from "../../../components/notices";
import { SPOT_PROBLEMS, TenderDetailView } from "../../../components/spot-views";
import { apiRequest, organizationDetailSchema } from "../../../lib/api-client";
import { getAuthDeps } from "../../../lib/deps";
import { tenderDetailSchema } from "../../../lib/spot";
import { requireOrganizationPage } from "../../../lib/viewer";

export const metadata: Metadata = { title: "Spot freight offer" };
export const dynamic = "force-dynamic";

export default async function SpotOfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const problem = typeof query["problem"] === "string" ? query["problem"] : "";
  const { viewer, allowed } = await requireOrganizationPage("spot:read");
  const canManage = viewer.active.permissions.includes("spot:manage");
  let title = "Spot freight offer";
  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const base = {
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
    };
    const [tender, organization] = await Promise.all([
      apiRequest({
        ...base,
        path: `/v1/spot-tenders/${encodeURIComponent(id)}`,
        schema: tenderDetailSchema,
      }),
      apiRequest({ ...base, path: "/v1/organization", schema: organizationDetailSchema }),
    ]);
    if (tender.ok) {
      title = `Offer for ${tender.data.transport.reference}`;
      content = (
        <div className="space-y-4">
          {problem && SPOT_PROBLEMS[problem] ? <Notice>{SPOT_PROBLEMS[problem]}</Notice> : null}
          <TenderDetailView
            tender={tender.data}
            canManage={canManage}
            timeZone={organization.ok ? organization.data.timezone : "UTC"}
          />
        </div>
      );
    } else {
      content = (
        <Notice>
          {tender.status === 404 || tender.status === 400
            ? "This offer does not exist."
            : "The offer could not be loaded right now. Please try again in a moment."}{" "}
          <a href="/spot" className="underline">
            Back to all offers
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
