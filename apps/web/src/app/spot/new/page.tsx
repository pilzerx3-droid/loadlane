import type { Metadata } from "next";
import { PageHeader } from "@loadlane/ui";
import { isoToLocalInput } from "@loadlane/shared";
import { AppShell } from "../../../components/app-shell";
import { ForbiddenNotice, Notice } from "../../../components/notices";
import { SpotNewForm } from "../../../components/spot-new-form";
import { apiRequest, organizationDetailSchema } from "../../../lib/api-client";
import { getAuthDeps } from "../../../lib/deps";
import { optionListSchema, transportDetailSchema } from "../../../lib/transport-api";
import { requireOrganizationPage } from "../../../lib/viewer";

export const metadata: Metadata = { title: "Offer to carriers" };
export const dynamic = "force-dynamic";

export default async function NewSpotPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { viewer, allowed } = await requireOrganizationPage("spot:manage");
  const params = await searchParams;
  const transportId = typeof params["transport"] === "string" ? params["transport"] : "";
  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const base = {
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
    };
    const [transport, carriers, organization] = await Promise.all([
      apiRequest({
        ...base,
        path: `/v1/transports/${encodeURIComponent(transportId)}`,
        schema: transportDetailSchema,
      }),
      apiRequest({ ...base, path: "/v1/carriers?limit=100", schema: optionListSchema }),
      apiRequest({ ...base, path: "/v1/organization", schema: organizationDetailSchema }),
    ]);
    if (!transport.ok || !carriers.ok) {
      content = (
        <Notice>
          Choose a transport first.{" "}
          <a href="/transports" className="underline">
            Go to transports
          </a>
        </Notice>
      );
    } else if (transport.data.status !== "created" && transport.data.status !== "planned") {
      content = (
        <Notice>Only a transport that is created or planned can be offered to carriers.</Notice>
      );
    } else {
      const zone = organization.ok ? organization.data.timezone : "UTC";
      content = (
        <SpotNewForm
          transportId={transport.data.id}
          transportReference={transport.data.reference}
          carriers={carriers.data.items.map((item) => ({ id: item.id, name: item.name }))}
          defaultDeadline={isoToLocalInput(
            new Date(Date.now() + 24 * 3_600_000).toISOString(),
            zone,
          )}
        />
      );
    }
  }
  return (
    <AppShell viewer={viewer}>
      <PageHeader title="Offer to carriers" description="Closed offer to the carriers you choose" />
      {content}
    </AppShell>
  );
}
