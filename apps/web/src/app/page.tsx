import { redirect } from "next/navigation";
import { Badge, Card, CardDescription, CardHeader, CardTitle, PageHeader } from "@loadlane/ui";
import { AppShell } from "../components/app-shell";
import { Dashboard, summarySchema } from "../components/dashboard";
import { roleLabel } from "../components/members-table";
import { NotConfiguredScreen, Notice, ProblemScreen, SignedOutScreen } from "../components/notices";
import { apiRequest } from "../lib/api-client";
import { getAuthDeps } from "../lib/deps";
import { getViewer } from "../lib/viewer";

// The page depends on the visitor's session cookie, so it is rendered for every request.
export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { error } = await searchParams;
  const result = await getViewer();

  if (result === "not_configured") return <NotConfiguredScreen />;
  if (result.kind === "signed_out") {
    return <SignedOutScreen error={typeof error === "string" ? error : undefined} />;
  }
  if (result.kind === "problem") return <ProblemScreen problem={result.problem} />;

  const { viewer } = result;
  if (!viewer.active) redirect("/onboarding");
  const canReadTransports = viewer.active.permissions.includes("transport:read");
  const summary = canReadTransports
    ? await apiRequest({
        apiUrl: getAuthDeps().config.apiUrl,
        accessToken: viewer.accessToken,
        organizationId: viewer.active.id,
        path: "/v1/transports/summary",
        schema: summarySchema,
      })
    : undefined;
  const firstName = viewer.user.displayName.split(/\s+/)[0] ?? viewer.user.displayName;

  return (
    <AppShell viewer={{ ...viewer, active: viewer.active }}>
      <PageHeader title={`Welcome, ${firstName}`} description={viewer.active.name} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div>
          {summary?.ok ? (
            <Dashboard
              summary={summary.data}
              canManage={viewer.active.permissions.includes("transport:manage")}
            />
          ) : summary ? (
            <Notice>
              The numbers could not be loaded right now. Please try again in a moment.
            </Notice>
          ) : (
            <Card className="p-5 text-sm text-muted-foreground">
              Your roles do not include transports. Ask an administrator if you need them.
            </Card>
          )}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Your access</CardTitle>
          </CardHeader>
          <CardDescription className="mb-3">Your roles in {viewer.active.name}</CardDescription>
          {viewer.active.roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You have no role yet. Ask an administrator to assign one.
            </p>
          ) : (
            <p className="flex flex-wrap gap-1.5">
              {viewer.active.roles.map((role) => (
                <Badge key={role}>{roleLabel(role)}</Badge>
              ))}
            </p>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
