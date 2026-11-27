"use client";

import { useActionState } from "react";
import { Button } from "@loadlane/ui";
import { createDriverLinkAction, type CreateLinkState } from "../app/driver-link-actions";
import { Notice } from "./notices";

/** Creates a Driver Link and shows it once. Reloading the page makes it unreadable on purpose. */
export function DriverLinkCreate({ transportId }: { transportId: string }) {
  const [state, action, pending] = useActionState(
    createDriverLinkAction.bind(null, transportId),
    {} as CreateLinkState,
  );
  return (
    <form action={action} className="space-y-3">
      {state.message ? <Notice>{state.message}</Notice> : null}
      {state.url ? (
        <div className="rounded-control border border-border p-3" aria-live="polite">
          <p className="text-sm font-semibold">Send this link to the driver now</p>
          <p className="mt-1 text-xs text-muted-foreground">
            It is shown only once and cannot be looked up later. Valid until{" "}
            {new Date(state.expiresAt ?? "").toLocaleString("en-US")}.
          </p>
          <input
            readOnly
            value={state.url}
            aria-label="Driver Link"
            onFocus={(event) => event.currentTarget.select()}
            className="mt-2 w-full rounded-control border border-border bg-card px-3 py-2 font-mono text-xs"
          />
        </div>
      ) : null}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Creating…" : "Create Driver Link"}
      </Button>
    </form>
  );
}
