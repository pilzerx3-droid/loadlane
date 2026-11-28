import type { Metadata } from "next";
import { PageHeader } from "@loadlane/ui";
import { AppShell } from "../../components/app-shell";
import { ForbiddenNotice, Notice } from "../../components/notices";
import { QuotesList } from "../../components/quote-views";
import { apiRequest } from "../../lib/api-client";
import { getAuthDeps } from "../../lib/deps";
import { quoteListSchema } from "../../lib/quotes";
import { requireOrganizationPage } from "../../lib/viewer";

export const metadata: Metadata = { title: "Quotes" };
export const dynamic = "force-dynamic";

export default async function QuotesPage() {
  const { viewer, allowed } = await requireOrganizationPage("quote:read");
  const canManage = viewer.active.permissions.includes("quote:manage");
  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const list = await apiRequest({
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
      path: "/v1/quotes?limit=50",
      schema: quoteListSchema,
    });
    content = list.ok ? (
      <QuotesList items={list.data.items} canManage={canManage} />
    ) : (
      <Notice>The quotes could not be loaded right now. Please try again in a moment.</Notice>
    );
  }
  return (
    <AppShell viewer={viewer}>
      <PageHeader title="Quotes" description="Offers to customers, from frozen calculations" />
      {content}
    </AppShell>
  );
}
