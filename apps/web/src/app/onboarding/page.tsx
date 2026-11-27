import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@loadlane/ui";
import { AppShell } from "../../components/app-shell";
import { CenteredCard } from "../../components/notices";
import { OnboardingForm } from "../../components/onboarding-form";
import { getViewer } from "../../lib/viewer";

export const metadata: Metadata = { title: "Create an organization" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const result = await getViewer();
  if (result === "not_configured" || result.kind !== "ok") redirect("/");
  const { viewer } = result;

  const timeZones = Intl.supportedValuesOf("timeZone");
  const form = <OnboardingForm timeZones={timeZones} />;

  // Someone who already belongs to an organization gets the normal frame; a new person gets a plain page.
  if (viewer.active) {
    return (
      <AppShell viewer={{ ...viewer, active: viewer.active }}>
        <PageHeader title="Create an organization" description="You become its administrator." />
        <div className="max-w-xl rounded-card border border-border bg-card p-6">{form}</div>
      </AppShell>
    );
  }

  return (
    <CenteredCard>
      <h1 className="text-2xl leading-tight font-semibold tracking-tight">
        Create your organization
      </h1>
      <p className="text-muted-foreground">
        Welcome, {viewer.user.displayName}. Your organization is the space for your team, carriers
        and transports. You become its administrator.
      </p>
      {form}
    </CenteredCard>
  );
}
