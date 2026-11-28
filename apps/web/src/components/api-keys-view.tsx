"use client";

import { useActionState } from "react";
import { formatInZone } from "@loadlane/shared";
import { Button, Card, CardHeader, CardTitle, Input } from "@loadlane/ui";
import {
  createApiKeyAction,
  revokeApiKeyAction,
  type CreateKeyState,
} from "../app/api-key-actions";
import { SCOPE_LABELS, type KeySummary } from "../lib/api-keys";
import { Notice } from "./notices";

/** API keys for other systems. The secret is shown once, right after creating. */
export function ApiKeysView({ keys, timeZone }: { keys: KeySummary[]; timeZone: string }) {
  const [state, action, pending] = useActionState(createApiKeyAction, {} as CreateKeyState);
  return (
    <div className="space-y-5">
      <Card className="space-y-3 p-5">
        <CardHeader>
          <CardTitle>Create an API key</CardTitle>
        </CardHeader>
        <p className="text-sm text-muted-foreground">
          A key lets another system (ERP, TMS, middleware) call the integration API of this
          organization. It acts for the organization, not for a person. See docs/integration-api.md.
        </p>
        {state.message ? <Notice>{state.message}</Notice> : null}
        {state.key ? (
          <div className="rounded-control border border-border p-3" aria-live="polite">
            <p className="text-sm font-semibold">Copy the key now</p>
            <p className="mt-1 text-xs text-muted-foreground">
              It is shown only once and cannot be looked up later. Store it in the other system's
              secret store, never in a document or an e-mail.
            </p>
            <input
              readOnly
              value={state.key}
              aria-label="API key"
              onFocus={(event) => event.currentTarget.select()}
              className="mt-2 w-full rounded-control border border-border bg-card px-3 py-2 font-mono text-xs"
            />
          </div>
        ) : null}
        <form action={action} className="space-y-3">
          <div>
            <label htmlFor="key-name" className="mb-1 block text-[13px] font-semibold">
              Name (which system)
            </label>
            <Input id="key-name" name="name" placeholder="SAP middleware" required />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-[13px] font-semibold">Permissions</legend>
            {Object.entries(SCOPE_LABELS).map(([scope, label]) => (
              <label key={scope} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="scope" value={scope} defaultChecked />
                {label}
              </label>
            ))}
          </fieldset>
          <Button type="submit" variant="solid" disabled={pending}>
            {pending ? "Creating…" : "Create key"}
          </Button>
        </form>
      </Card>

      <Card className="p-5">
        <CardHeader>
          <CardTitle>Keys</CardTitle>
        </CardHeader>
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No API keys yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {key.name}{" "}
                    <span className="font-mono text-muted-foreground">{key.prefix}…</span>
                    {key.state === "revoked" ? " · revoked" : ""}
                  </p>
                  <p className="text-muted-foreground">
                    {key.scopes.join(", ")} · created {formatInZone(key.createdAt, timeZone)} by{" "}
                    {key.createdBy.displayName} ·{" "}
                    {key.lastUsedAt
                      ? `last used ${formatInZone(key.lastUsedAt, timeZone)}`
                      : "never used"}
                  </p>
                </div>
                {key.state === "active" ? (
                  <form action={revokeApiKeyAction.bind(null, key.id)}>
                    <Button type="submit" variant="ghost" size="sm">
                      Revoke
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
