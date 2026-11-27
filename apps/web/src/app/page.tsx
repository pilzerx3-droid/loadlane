import { cookies } from "next/headers";
import { cookieNames } from "../lib/cookies";
import { getAuthDeps } from "../lib/deps";
import { loadHome, type HomeState } from "../lib/home";

// The page depends on the visitor's session cookie, so it is rendered for every request.
export const dynamic = "force-dynamic";

const ERROR_TEXT: Record<string, string> = {
  login_expired: "The sign-in took too long or was already used. Please try again.",
  access_denied: "The sign-in was cancelled or not allowed.",
  login_failed: "The sign-in could not be completed. Please try again.",
  provider_unavailable:
    "The sign-in service is not reachable right now. Please try again in a moment.",
};

const PROBLEM_TEXT = {
  email_not_verified:
    "Your e-mail address is not verified at the sign-in provider. Verify it there, then sign in again.",
  email_in_use:
    "This e-mail address is already registered with a different sign-in. Please contact support.",
  account_disabled: "Your account is deactivated. Please contact your administrator.",
  unavailable: "Loadlane is temporarily unavailable. Please try again in a moment.",
} as const;

function SignOut() {
  return (
    <form action="/logout" method="post">
      <button type="submit">Sign out</button>
    </form>
  );
}

async function resolveState(): Promise<HomeState | "not_configured"> {
  try {
    const deps = getAuthDeps();
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(cookieNames(deps.config.secureCookies).session)?.value;
    return await loadHome(sessionId, deps);
  } catch (error) {
    console.error("Could not load the start page:", error instanceof Error ? error.message : error);
    // A missing or invalid configuration is a setup problem; everything else (for example Valkey down) is temporary.
    return error instanceof Error && error.message.startsWith("Invalid web configuration")
      ? "not_configured"
      : { kind: "problem", problem: "unavailable" };
  }
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { error } = await searchParams;
  const errorText = typeof error === "string" ? ERROR_TEXT[error] : undefined;
  const state = await resolveState();

  return (
    <main
      style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1rem", fontFamily: "system-ui" }}
    >
      <h1>Loadlane</h1>
      {errorText && <p role="alert">{errorText}</p>}

      {state === "not_configured" && (
        <p role="alert">
          Sign-in is not configured. Copy .env.example to .env and follow docs/dev-setup-zitadel.md.
        </p>
      )}

      {state !== "not_configured" && state.kind === "signed_out" && (
        <>
          <p>Sign in to see your transports.</p>
          <a href="/login">Sign in</a>
        </>
      )}

      {state !== "not_configured" && state.kind === "problem" && (
        <>
          <p role="alert">{PROBLEM_TEXT[state.problem]}</p>
          <SignOut />
        </>
      )}

      {state !== "not_configured" && state.kind === "signed_in" && (
        <>
          <p>
            Signed in as <strong>{state.me.user.displayName}</strong> ({state.me.user.email})
          </p>
          <h2>Organizations</h2>
          {state.me.organizations.length === 0 ? (
            <p>You are not a member of an organization yet.</p>
          ) : (
            <ul>
              {state.me.organizations.map((organization) => (
                <li key={organization.id}>
                  {organization.name} ({organization.region.toUpperCase()})
                </li>
              ))}
            </ul>
          )}
          <SignOut />
        </>
      )}
    </main>
  );
}
