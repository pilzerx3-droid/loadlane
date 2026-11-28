"use client";

import { useState, useTransition } from "react";
import { formatInZone, formatUsd, formatWindow } from "@loadlane/shared";
import { Button, Card, Input } from "@loadlane/ui";
import { submitCarrierBidAction, withdrawCarrierBidAction } from "../app/spot-carrier-actions";
import { CARRIER_FAILURE_MESSAGES, type CarrierOffer, type CarrierResult } from "../lib/spot";
import { Notice } from "./notices";

const STATE_TEXT: Record<CarrierOffer["state"], string> = {
  open: "Open for bids",
  deadline_passed: "The response deadline has passed",
  awarded_to_you: "Awarded to you",
  closed: "This offer is closed",
};

const BID_STATUS_TEXT = {
  submitted: "Sent, waiting for the shipper's decision",
  superseded: "Replaced by a newer price",
  withdrawn: "Withdrawn",
  rejected: "Not selected",
  awarded: "Selected by the shipper",
} as const;

/** The carrier's page: the lane, the deadline and a price field. Never the customer or other bids. */
export function SpotCarrierConsole({ token, initial }: { token: string; initial: CarrierOffer }) {
  const [offer, setOffer] = useState(initial);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  function apply(result: CarrierResult) {
    if (result.ok) {
      setOffer(result.data);
      setMessage(undefined);
    } else {
      setMessage(CARRIER_FAILURE_MESSAGES[result.reason]);
    }
  }
  const timeZone = offer.stops[0]?.timezone ?? "UTC";
  const live = offer.yourBid?.status === "submitted";

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">Load offer</p>
        <h1 className="text-2xl font-semibold">{offer.transportReference}</h1>
        <p className="mt-2 inline-block rounded-control border border-border px-3 py-1 text-sm font-medium">
          {STATE_TEXT[offer.state]}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Respond by {formatInZone(offer.responseDeadline, timeZone)} (local time of the pickup)
        </p>
      </div>

      <ol className="space-y-3">
        {offer.stops.map((stop) => (
          <li key={stop.sequence} className="rounded-control border border-border p-3 text-sm">
            <p className="font-semibold">
              {stop.type === "pickup" ? "Pickup" : "Delivery"} · {stop.city}, {stop.state}
            </p>
            <p className="text-muted-foreground">
              {formatWindow(stop.windowStart, stop.windowEnd, stop.timezone)} (local time)
            </p>
          </li>
        ))}
      </ol>
      {offer.weightLb !== null || offer.pieces !== null ? (
        <p className="text-sm">
          {offer.weightLb !== null ? `${offer.weightLb.toLocaleString("en-US")} lb` : ""}
          {offer.weightLb !== null && offer.pieces !== null ? " · " : ""}
          {offer.pieces !== null ? `${offer.pieces} pieces` : ""}
        </p>
      ) : null}

      {message ? <Notice>{message}</Notice> : null}

      {offer.yourBid ? (
        <Card className="space-y-1 p-4" aria-label="Your bid">
          <p className="font-semibold">Your price: {formatUsd(offer.yourBid.priceCents)}</p>
          <p className="text-sm text-muted-foreground">{BID_STATUS_TEXT[offer.yourBid.status]}</p>
          {offer.yourBid.note ? <p className="text-sm">{offer.yourBid.note}</p> : null}
          {live && offer.state === "open" ? (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => apply(await withdrawCarrierBidAction(token)))
              }
            >
              Withdraw my bid
            </Button>
          ) : null}
        </Card>
      ) : null}

      {offer.state === "open" ? (
        <Card className="space-y-3 p-4">
          <h2 className="text-lg font-semibold">
            {live ? "Change your price" : "Send your price"}
          </h2>
          <div>
            <label htmlFor="spot-price" className="mb-1 block text-[13px] font-semibold">
              Total price in US dollars
            </label>
            <Input
              id="spot-price"
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="$ 850.00"
            />
          </div>
          <div>
            <label htmlFor="spot-note" className="mb-1 block text-[13px] font-semibold">
              Note (optional), for example when your truck can load
            </label>
            <Input id="spot-note" value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <Button
            variant="solid"
            disabled={pending || price.trim() === ""}
            onClick={() =>
              startTransition(async () => {
                const result = await submitCarrierBidAction(token, price, note);
                apply(result);
                if (result.ok) setPrice("");
              })
            }
          >
            {live ? "Replace my bid" : "Send bid"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Only the shipper sees your price. The shipper decides; sending a bid does not award the
            load.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
