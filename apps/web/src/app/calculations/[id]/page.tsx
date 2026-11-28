import type { Metadata } from "next";
import { Button, PageHeader } from "@loadlane/ui";
import { AppShell } from "../../../components/app-shell";
import { CalculationDetailView } from "../../../components/calculation-views";
import { ForbiddenNotice, Notice } from "../../../components/notices";
import { apiRequest, organizationDetailSchema } from "../../../lib/api-client";
import { calculationDetailSchema } from "../../../lib/calculations";
import { getAuthDeps } from "../../../lib/deps";
import { requireOrganizationPage } from "../../../lib/viewer";

export const metadata: Metadata = { title: "Calculation" };
export const dynamic = "force-dynamic";

export default async function CalculationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer, allowed } = await requireOrganizationPage("calculation:read");
  let title = "Calculation";
  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const base = {
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
    };
    const [result, organization] = await Promise.all([
      apiRequest({
        ...base,
        path: `/v1/calculations/${encodeURIComponent(id)}`,
        schema: calculationDetailSchema,
      }),
      apiRequest({ ...base, path: "/v1/organization", schema: organizationDetailSchema }),
    ]);
    if (result.ok) {
      title = result.data.name;
      content = (
        <CalculationDetailView
          calculation={result.data}
          timeZone={organization.ok ? organization.data.timezone : "UTC"}
        />
      );
    } else {
      content = (
        <Notice>
          {result.status === 404 || result.status === 400
            ? "This calculation does not exist."
            : "The calculation could not be loaded right now. Please try again in a moment."}{" "}
          <a href="/calculations" className="underline">
            Back to all calculations
          </a>
        </Notice>
      );
    }
  }
  const canQuote = viewer.active.permissions.includes("quote:manage");
  return (
    <AppShell viewer={viewer}>
      <PageHeader
        title={title}
        actions={
          allowed && canQuote && title !== "Calculation" ? (
            <Button asChild variant="outline">
              <a href={`/quotes/new?calculation=${encodeURIComponent(id)}`}>Create quote</a>
            </Button>
          ) : undefined
        }
      />
      {content}
    </AppShell>
  );
}
