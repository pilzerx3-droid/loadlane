import type { Metadata } from "next";
import { PageHeader } from "@loadlane/ui";
import { AppShell } from "../../../components/app-shell";
import { ForbiddenNotice, Notice } from "../../../components/notices";
import { QUOTE_PROBLEMS, QuoteDetailView } from "../../../components/quote-views";
import { apiRequest, organizationDetailSchema } from "../../../lib/api-client";
import { getAuthDeps } from "../../../lib/deps";
import { quoteDetailSchema } from "../../../lib/quotes";
import { requireOrganizationPage } from "../../../lib/viewer";

export const metadata: Metadata = { title: "Quote" };
export const dynamic = "force-dynamic";

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const problem = typeof query["problem"] === "string" ? query["problem"] : "";
  const { viewer, allowed } = await requireOrganizationPage("quote:read");
  const canManage = viewer.active.permissions.includes("quote:manage");
  let title = "Quote";
  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const base = {
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
    };
    const [quote, organization] = await Promise.all([
      apiRequest({
        ...base,
        path: `/v1/quotes/${encodeURIComponent(id)}`,
        schema: quoteDetailSchema,
      }),
      apiRequest({ ...base, path: "/v1/organization", schema: organizationDetailSchema }),
    ]);
    if (quote.ok) {
      title = quote.data.reference;
      content = (
        <div className="space-y-4">
          {problem && QUOTE_PROBLEMS[problem] ? <Notice>{QUOTE_PROBLEMS[problem]}</Notice> : null}
          <QuoteDetailView
            quote={quote.data}
            canManage={canManage}
            canCreateTransport={viewer.active.permissions.includes("transport:manage")}
            timeZone={organization.ok ? organization.data.timezone : "UTC"}
          />
        </div>
      );
    } else {
      content = (
        <Notice>
          {quote.status === 404 || quote.status === 400
            ? "This quote does not exist."
            : "The quote could not be loaded right now. Please try again in a moment."}{" "}
          <a href="/quotes" className="underline">
            Back to all quotes
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
