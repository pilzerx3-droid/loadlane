"use client";

import { useActionState } from "react";
import { Button, Card, CardHeader, CardTitle } from "@loadlane/ui";
import {
  createTrackingLinkAction,
  revokeTrackingLinkAction,
  type CreateTrackingState,
} from "../app/tracking-link-actions";
import type { TrackingLinkItem } from "../lib/tracking-links";
import { Notice } from "./notices";

const STATE_LABELS = { active: "Active", expired: "Expired", revoked: "Revoked" } as const;

/** Customer tracking links: a status page for the shipper's customer. It never shows a driver position. */
export function TrackingLinksCard({
  transportId,
  links,
  canManage,
  timeZone,
}: {
  transportId: string;
  links: TrackingLinkItem[];
  canManage: boolean;
  timeZone: string;
}) {
  const [state, action, pending] = useActionState(
    createTrackingLinkAction.bind(null, transportId),
    {} as CreateTrackingState,
  );
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <Card className="p-5">
      <CardHeader>
        <CardTitle>Customer tracking link</CardTitle>
      </CardHeader>
      <p className="mb-3 text-sm text-muted-foreground">
        Your customer sees the status, planned windows and status history without an account. No
        prices, carrier, driver or position are shown.
      </p>
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tracking link created yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {links.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="text-sm">
                <p className="font-medium">
                  {STATE_LABELS[link.state]}
                  {link.state === "active"
                    ? ` · until ${format.format(new Date(link.expiresAt))}`
                    : ""}
                </p>
                <p className="text-muted-foreground">
                  Created {format.format(new Date(link.createdAt))} by {link.createdBy.displayName}
                </p>
              </div>
              {canManage && link.state === "active" ? (
                <form action={revokeTrackingLinkAction.bind(null, transportId, link.id)}>
                  <Button type="submit" variant="ghost" size="sm">
                    Revoke
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form action={action} className="mt-5 space-y-3 border-t border-border pt-4">
          {state.message ? <Notice>{state.message}</Notice> : null}
          {state.url ? (
            <div className="rounded-control border border-border p-3" aria-live="polite">
              <p className="text-sm font-semibold">Send this link to your customer now</p>
              <p className="mt-1 text-xs text-muted-foreground">
                It is shown only once. Valid until{" "}
                {new Date(state.expiresAt ?? "").toLocaleString("en-US")}.
              </p>
              <input
                readOnly
                value={state.url}
                aria-label="Customer tracking link"
                onFocus={(event) => event.currentTarget.select()}
                className="mt-2 w-full rounded-control border border-border bg-card px-3 py-2 font-mono text-xs"
              />
            </div>
          ) : null}
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Creating…" : "Create tracking link"}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
