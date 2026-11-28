"use client";

import { useActionState } from "react";
import { Button, Card, CardHeader, CardTitle, Input } from "@loadlane/ui";
import {
  createWebhookAction,
  disableWebhookAction,
  type CreateWebhookState,
} from "../app/webhook-actions";
import type { WebhookSummary } from "../lib/webhooks";
import { Notice } from "./notices";

/** Webhook endpoints: addresses that receive signed calls when a transport changes status. */
export function WebhooksView({ hooks }: { hooks: WebhookSummary[] }) {
  const [state, action, pending] = useActionState(createWebhookAction, {} as CreateWebhookState);
  return (
    <Card className="mt-5 space-y-4 p-5">
      <CardHeader>
        <CardTitle>Webhooks</CardTitle>
      </CardHeader>
      <p className="text-sm text-muted-foreground">
        Loadlane calls your address with a signed message when a transport changes status (
        <span className="font-mono">transport.status_changed</span>), a quote changes status (
        <span className="font-mono">quote.status_changed</span>) or a spot offer is awarded or
        cancelled (<span className="font-mono">spot.status_changed</span>). Each message has the
        reference, the old and new status and, for transports, your own id if it came through the
        API: no prices, names, drivers or positions. Failed calls are retried six times over about
        15 hours. Verify each call with the header{" "}
        <span className="font-mono">X-Loadlane-Signature</span> (HMAC-SHA256 of the timestamp, a dot
        and the raw body, with your secret) and use the event id to ignore repeats.
      </p>
      {hooks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No webhook yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {hooks.map((hook) => (
            <li key={hook.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0 text-sm">
                <p className="break-all font-mono">{hook.url}</p>
                <p className="text-muted-foreground">
                  {hook.state === "active" ? "Active" : "Switched off"} · {hook.pending} waiting ·{" "}
                  {hook.failed} given up
                </p>
              </div>
              {hook.state === "active" ? (
                <form action={disableWebhookAction.bind(null, hook.id)}>
                  <Button type="submit" variant="ghost" size="sm">
                    Switch off
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <form action={action} className="space-y-3 border-t border-border pt-4">
        {state.message ? <Notice>{state.message}</Notice> : null}
        {state.secret ? (
          <div className="rounded-control border border-border p-3" aria-live="polite">
            <p className="text-sm font-semibold">Copy the signing secret now</p>
            <p className="mt-1 text-xs text-muted-foreground">
              It is shown only once and cannot be looked up later.
            </p>
            <input
              readOnly
              value={state.secret}
              aria-label="Signing secret"
              onFocus={(event) => event.currentTarget.select()}
              className="mt-2 w-full rounded-control border border-border bg-card px-3 py-2 font-mono text-xs"
            />
          </div>
        ) : null}
        <div>
          <label htmlFor="webhook-url" className="mb-1 block text-[13px] font-semibold">
            Address that receives the events
          </label>
          <Input
            id="webhook-url"
            name="url"
            type="url"
            placeholder="https://example.com/loadlane-events"
            autoComplete="off"
            required
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Adding…" : "Add webhook"}
        </Button>
      </form>
    </Card>
  );
}
