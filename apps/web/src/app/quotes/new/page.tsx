import type { Metadata } from "next";
import { PageHeader } from "@loadlane/ui";
import { AppShell } from "../../../components/app-shell";
import { ForbiddenNotice, Notice } from "../../../components/notices";
import { NewQuoteForm, QUOTE_PROBLEMS } from "../../../components/quote-views";
import { apiRequest } from "../../../lib/api-client";
import { calculationDetailSchema } from "../../../lib/calculations";
import { getAuthDeps } from "../../../lib/deps";
import { optionListSchema } from "../../../lib/transport-api";
import { requireOrganizationPage } from "../../../lib/viewer";

export const metadata: Metadata = { title: "New quote" };
export const dynamic = "force-dynamic";

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { viewer, allowed } = await requireOrganizationPage("quote:manage");
  const params = await searchParams;
  const calculationId = typeof params["calculation"] === "string" ? params["calculation"] : "";
  const problem = typeof params["problem"] === "string" ? params["problem"] : "";
  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const base = {
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
    };
    const calculation = await apiRequest({
      ...base,
      path: `/v1/calculations/${encodeURIComponent(calculationId)}`,
      schema: calculationDetailSchema,
    });
    if (!calculation.ok) {
      content = (
        <Notice>
          Choose a saved calculation first.{" "}
          <a href="/calculations" className="underline">
            Go to calculations
          </a>
        </Notice>
      );
    } else {
      const customers =
        calculation.data.customer === null && viewer.active.permissions.includes("customer:read")
          ? await apiRequest({ ...base, path: "/v1/customers?limit=100", schema: optionListSchema })
          : undefined;
      const defaultValidUntil = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
      content = (
        <div className="space-y-4">
          {problem && QUOTE_PROBLEMS[problem] ? <Notice>{QUOTE_PROBLEMS[problem]}</Notice> : null}
          <NewQuoteForm
            calculationId={calculation.data.id}
            calculationName={calculation.data.name}
            priceCents={calculation.data.priceCents}
            customerFixed={calculation.data.customer !== null}
            customers={(customers?.ok ? customers.data.items : []).map((item) => ({
              id: item.id,
              label: item.name,
            }))}
            defaultValidUntil={defaultValidUntil}
          />
        </div>
      );
    }
  }
  return (
    <AppShell viewer={viewer}>
      <PageHeader title="New quote" description="Offer a calculated price to a customer" />
      {content}
    </AppShell>
  );
}
