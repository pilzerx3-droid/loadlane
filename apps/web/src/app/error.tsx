"use client";

import { Button } from "@loadlane/ui";
import { CenteredCard } from "../components/notices";

/** Last line of defense: shows a calm message instead of a stack trace. Details stay in the server log. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <CenteredCard>
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground">
        The page could not be shown. You can try again, or come back in a moment.
      </p>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">Reference: {error.digest}</p>
      ) : null}
      <Button onClick={reset}>Try again</Button>
    </CenteredCard>
  );
}
