import type { Metadata } from "next";
import { Card, CardDescription, PageHeader } from "@loadlane/ui";
import { AppShell } from "../../components/app-shell";
import { ForbiddenNotice, Notice } from "../../components/notices";
import { OrganizationDetails } from "../../components/organization-details";
import { apiRequest, organizationDetailSchema } from "../../lib/api-client";
import { getAuthDeps } from "../../lib/deps";
import { requireOrganizationPage } from "../../lib/viewer";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { viewer, allowed } = await requireOrganizationPage("organization:read");

  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const result = await apiRequest({
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
      path: "/v1/organization",
      schema: organizationDetailSchema,
    });
    content = result.ok ? (
      <Card>
        <OrganizationDetails organization={result.data} />
        <CardDescription className="mt-6 border-t border-border pt-4">
          These settings cannot be changed yet.
        </CardDescription>
      </Card>
    ) : result.status === 403 ? (
      <ForbiddenNotice />
    ) : (
      <Notice>The settings could not be loaded right now. Please try again in a moment.</Notice>
    );
  }

  return (
    <AppShell viewer={viewer}>
      <PageHeader
        title="Settings"
        description={`${viewer.active.name}: units, currency and time zone`}
      />
      {content}
    </AppShell>
  );
}
