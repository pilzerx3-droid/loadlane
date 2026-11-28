import type { Metadata } from "next";
import { describeAge, FRESHNESS_LABELS, TRANSPORT_STATUS_LABELS } from "@loadlane/shared";
import { PageHeader } from "@loadlane/ui";
import { AppShell } from "../../components/app-shell";
import { ForbiddenNotice, Notice } from "../../components/notices";
import { TransportMap } from "../../components/transport-map";
import { apiRequest } from "../../lib/api-client";
import { getAuthDeps } from "../../lib/deps";
import { mapConfig } from "../../lib/map-config";
import { mapDataSchema } from "../../lib/map-data";
import { requireOrganizationPage } from "../../lib/viewer";

export const metadata: Metadata = { title: "Map" };
export const dynamic = "force-dynamic";

function statusLabel(status: string): string {
  return (TRANSPORT_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

export default async function MapPage() {
  const { viewer, allowed } = await requireOrganizationPage("transport:read");
  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const result = await apiRequest({
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
      path: "/v1/map/transports",
      schema: mapDataSchema,
    });
    if (!result.ok) {
      content = (
        <Notice>The map could not be loaded right now. Please try again in a moment.</Notice>
      );
    } else {
      const data = result.data;
      content = (
        <div className="space-y-5">
          <TransportMap
            key={data.generatedAt}
            data={data}
            styleUrl={mapConfig(process.env).styleUrl}
          />
          {data.locationsWithoutCoordinates.length > 0 ? (
            <Notice>
              {data.locationsWithoutCoordinates.length} location
              {data.locationsWithoutCoordinates.length === 1 ? " has" : "s have"} no coordinates
              yet, so their stops are not on the map:{" "}
              {data.locationsWithoutCoordinates
                .slice(0, 5)
                .map((location) => `${location.name} (${location.city}, ${location.state})`)
                .join(", ")}
              {data.locationsWithoutCoordinates.length > 5 ? " and more" : ""}.{" "}
              <a
                href={`/locations/${data.locationsWithoutCoordinates[0]?.id ?? ""}`}
                className="underline"
              >
                Add coordinates
              </a>
            </Notice>
          ) : null}
          <div className="overflow-hidden rounded-card border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Open transports and their last known position</caption>
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Transport</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Last known position</th>
                  <th className="px-3 py-2">Estimated arrival</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.transports.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-muted-foreground">
                      No open transports.
                    </td>
                  </tr>
                ) : (
                  data.transports.map((transport) => (
                    <tr key={transport.id}>
                      <td className="px-3 py-2 font-mono">
                        <a href={`/transports/${transport.id}`} className="underline">
                          {transport.reference}
                        </a>
                      </td>
                      <td className="px-3 py-2">{statusLabel(transport.status)}</td>
                      <td className="px-3 py-2">
                        {transport.lastPosition
                          ? `${describeAge(transport.lastPosition.ageMs)} · ${FRESHNESS_LABELS[transport.lastPosition.freshness]} · recorded ${new Date(transport.lastPosition.recordedAt).toLocaleString("en-US")}`
                          : "No position reported"}
                      </td>
                      <td className="px-3 py-2">
                        {transport.estimatedArrival
                          ? new Date(transport.estimatedArrival).toLocaleString("en-US")
                          : "None"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
  }
  return (
    <AppShell viewer={viewer}>
      <PageHeader
        title="Map"
        description="Open transports: planned stops and the last position drivers shared"
      />
      {content}
    </AppShell>
  );
}
