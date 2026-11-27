import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Button, Card } from "@loadlane/ui";
import type { ViewerProblem } from "../lib/viewer-core";

export const SIGN_IN_ERRORS: Record<string, string> = {
  login_expired: "The sign-in took too long or was already used. Please try again.",
  access_denied: "The sign-in was cancelled or not allowed.",
  login_failed: "The sign-in could not be completed. Please try again.",
  provider_unavailable:
    "The sign-in service is not reachable right now. Please try again in a moment.",
};

export const PROBLEM_TEXT: Record<ViewerProblem, string> = {
  email_not_verified:
    "Your e-mail address is not verified at the sign-in provider. Verify it there, then sign in again.",
  email_in_use:
    "This e-mail address is already registered with a different sign-in. Please contact support.",
  account_disabled: "Your account is deactivated. Please contact your administrator.",
  unavailable: "Loadlane is temporarily unavailable. Please try again in a moment.",
};

/** A message that must be noticed. It is announced to screen readers (role=alert). */
export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-control border border-warning/50 bg-warning/10 px-3.5 py-3 text-sm"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <div>{children}</div>
    </div>
  );
}

/** Full-page card for visitors who cannot continue: signed out, a problem with the account, setup missing. */
export function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <Card className="w-full max-w-md space-y-4 p-7">{children}</Card>
    </main>
  );
}

export function SignedOutScreen({ error }: { error?: string | undefined }) {
  const message = error ? SIGN_IN_ERRORS[error] : undefined;
  return (
    <CenteredCard>
      <div className="flex items-center gap-2.5 text-[17px] font-bold tracking-tight">
        <span aria-hidden="true" className="block size-5 rounded-md bg-accent" />
        Loadlane
      </div>
      <h1 className="text-2xl leading-tight font-semibold tracking-tight">Sign in to Loadlane</h1>
      <p className="text-muted-foreground">
        One place for your transports, documents and carriers.
      </p>
      {message ? <Notice>{message}</Notice> : null}
      <Button asChild size="lg" className="w-full">
        <a href="/login">Sign in</a>
      </Button>
    </CenteredCard>
  );
}

export function ProblemScreen({ problem }: { problem: ViewerProblem }) {
  return (
    <CenteredCard>
      <h1 className="text-xl font-semibold tracking-tight">Something needs your attention</h1>
      <Notice>{PROBLEM_TEXT[problem]}</Notice>
      <form action="/logout" method="post">
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </CenteredCard>
  );
}

export function NotConfiguredScreen() {
  return (
    <CenteredCard>
      <h1 className="text-xl font-semibold tracking-tight">Sign-in is not set up</h1>
      <Notice>
        Copy .env.example to .env and follow docs/dev-setup-zitadel.md, then restart the web app.
      </Notice>
    </CenteredCard>
  );
}

/** Shown inside the app when the person's roles do not include what a page needs. */
export function ForbiddenNotice() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-border px-6 py-12 text-center">
      <ShieldAlert aria-hidden="true" className="size-7 text-muted-foreground" />
      <h1 className="text-lg font-semibold tracking-tight">You do not have access to this page</h1>
      <p className="max-w-prose text-sm text-muted-foreground">
        Your role in this organization does not include it. Ask an administrator if you need access.
      </p>
    </div>
  );
}
