"use client";

import { useActionState } from "react";
import { Button, Card, Input } from "@loadlane/ui";
import { createTenderAction, type CreateTenderState } from "../app/spot-actions";
import { Notice } from "./notices";

const MAIL_LABELS = {
  sent: "E-mail sent",
  failed: "E-mail could not be sent: send this link yourself",
  skipped: "No contact e-mail stored: send this link yourself",
} as const;

export interface CarrierOption {
  id: string;
  name: string;
}

/** Offer one transport to chosen carriers. The links are shown once after creating. */
export function SpotNewForm({
  transportId,
  transportReference,
  carriers,
  defaultDeadline,
}: {
  transportId: string;
  transportReference: string;
  carriers: CarrierOption[];
  /** For a datetime-local field, in the organization's time zone. */
  defaultDeadline: string;
}) {
  const [state, action, pending] = useActionState(createTenderAction, {} as CreateTenderState);

  if (state.links && state.tenderId) {
    return (
      <div className="space-y-4" aria-live="polite">
        <Card className="space-y-3 p-5">
          <h2 className="text-base font-semibold">
            Offer created. Send each carrier its own link now
          </h2>
          <p className="text-sm text-muted-foreground">
            The links are shown only once and cannot be looked up later.{" "}
            {state.mailRequested
              ? "Carriers marked as sent got their link by e-mail. Send the others yourself."
              : "Copy each link into your own e-mail or message."}
          </p>
          <ul className="space-y-3">
            {state.links.map((link) => (
              <li key={link.carrierId}>
                <p className="text-sm font-medium">
                  {link.carrierName}
                  {link.mail ? (
                    <span className="ml-2 font-normal text-muted-foreground">
                      {MAIL_LABELS[link.mail]}
                    </span>
                  ) : null}
                </p>
                <input
                  readOnly
                  value={link.url}
                  aria-label={`Link for ${link.carrierName}`}
                  onFocus={(event) => event.currentTarget.select()}
                  className="mt-1 w-full rounded-control border border-border bg-card px-3 py-2 font-mono text-xs"
                />
              </li>
            ))}
          </ul>
        </Card>
        <Button asChild variant="solid">
          <a href={`/spot/${state.tenderId}`}>Open the offer</a>
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="transportId" value={transportId} />
      {state.message ? <Notice>{state.message}</Notice> : null}
      <Card className="space-y-4 p-5">
        <p className="text-sm">
          Offering transport <span className="font-semibold">{transportReference}</span> to the
          carriers you choose. Nothing is awarded automatically: you compare the bids and decide.
        </p>
        <div>
          <p className="mb-1 text-[13px] font-semibold">Carriers to invite</p>
          {carriers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No carriers yet.{" "}
              <a href="/carriers/new" className="underline">
                Add a carrier
              </a>
            </p>
          ) : (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {carriers.map((carrier) => (
                <li key={carrier.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="carrierId" value={carrier.id} />
                    {carrier.name}
                  </label>
                  <input type="hidden" name="carrierName" value={`${carrier.id}|${carrier.name}`} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="sendEmail" />
          E-mail each carrier its link (to the contact address stored on the carrier)
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="spot-deadline" className="mb-1 block text-[13px] font-semibold">
              Bids due by (your time zone)
            </label>
            <Input
              id="spot-deadline"
              name="responseDeadline"
              type="datetime-local"
              required
              defaultValue={defaultDeadline}
            />
          </div>
          <div>
            <label htmlFor="spot-target" className="mb-1 block text-[13px] font-semibold">
              Your target price (optional, never shown to carriers)
            </label>
            <Input id="spot-target" name="targetPrice" inputMode="decimal" placeholder="$ 0.00" />
          </div>
        </div>
        <div>
          <label htmlFor="spot-notes" className="mb-1 block text-[13px] font-semibold">
            Internal notes (optional)
          </label>
          <textarea
            id="spot-notes"
            name="notes"
            rows={2}
            className="w-full rounded-control border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
      </Card>
      <Button type="submit" variant="solid" disabled={pending || carriers.length === 0}>
        {pending ? "Creating…" : "Create offer"}
      </Button>
    </form>
  );
}
