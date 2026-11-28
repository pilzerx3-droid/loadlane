import { formatInZone, formatUsd, formatWindow } from "@loadlane/shared";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  NativeSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@loadlane/ui";
import { awardBidAction, cancelTenderAction, enterBidAction } from "../app/spot-actions";
import type { TenderDetail, TenderSummary } from "../lib/spot";

export const SPOT_PROBLEMS: Record<string, string> = {
  invalid: "These values were not accepted. Enter a price in dollars, for example 850.",
  not_open: "This offer is no longer open.",
  bid_not_live: "That bid is not valid any more (it was replaced or withdrawn).",
  not_offerable: "The transport has changed and can no longer be assigned from this offer.",
  forbidden: "You do not have permission to change spot freight offers.",
  not_found: "This offer no longer exists.",
  unavailable: "Loadlane could not save this right now. Please try again in a moment.",
};

const TENDER_STATUS = {
  open: "Open",
  awarded: "Awarded",
  cancelled: "Cancelled",
  closed: "Closed",
} as const;

const BID_STATUS = {
  submitted: "Valid",
  superseded: "Replaced",
  withdrawn: "Withdrawn",
  rejected: "Not selected",
  awarded: "Awarded",
} as const;

export function TendersList({ items, timeZone }: { items: TenderSummary[]; timeZone: string }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No spot freight offers yet"
        description="Open a transport that is created or planned and offer it to carriers."
        action={
          <a href="/transports" className="text-sm underline">
            Go to transports
          </a>
        }
      />
    );
  }
  return (
    <Card className="p-2 sm:p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Transport</TableHead>
            <TableHead>Lane</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Bids</TableHead>
            <TableHead className="text-right">Lowest</TableHead>
            <TableHead>Bids due</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <a href={`/spot/${item.id}`} className="font-medium hover:underline">
                  {item.transport.reference}
                </a>
              </TableCell>
              <TableCell>
                {item.origin} → {item.destination}
              </TableCell>
              <TableCell>
                {TENDER_STATUS[item.status]}
                {item.status === "open" && item.deadlinePassed ? " (deadline passed)" : ""}
              </TableCell>
              <TableCell className="text-right font-mono">
                {item.liveBids} / {item.invited}
              </TableCell>
              <TableCell className="text-right font-mono">
                {item.lowestLiveBidCents === null ? "—" : formatUsd(item.lowestLiveBidCents)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatInZone(item.responseDeadline, timeZone)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/** One offer: lane, every bid cheapest first with the award button, staff bid entry. The shipper decides. */
export function TenderDetailView({
  tender,
  canManage,
  timeZone,
}: {
  tender: TenderDetail;
  canManage: boolean;
  timeZone: string;
}) {
  const open = tender.status === "open";
  const live = tender.bids.filter((bid) => bid.status === "submitted");
  return (
    <div className="space-y-5">
      <Card className="space-y-2 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-lg font-semibold">
            {tender.origin} → {tender.destination}
          </p>
          <span className="rounded-control border border-border px-3 py-1 text-sm font-medium">
            {TENDER_STATUS[tender.status]}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Transport{" "}
          <a href={`/transports/${tender.transport.id}`} className="underline">
            {tender.transport.reference}
          </a>{" "}
          · bids due {formatInZone(tender.responseDeadline, timeZone)}
          {open && tender.deadlinePassed ? " (the deadline has passed; you can still decide)" : ""}
        </p>
        <ul className="text-sm">
          {tender.stops.map((stop) => (
            <li key={stop.sequence}>
              {stop.type === "pickup" ? "Pickup" : "Delivery"} · {stop.placeName}, {stop.city},{" "}
              {stop.state} · {formatWindow(stop.windowStart, stop.windowEnd, stop.timezone)}
            </li>
          ))}
        </ul>
        {tender.targetPriceCents !== null ? (
          <p className="text-sm">
            Your target price:{" "}
            <span className="font-mono">{formatUsd(tender.targetPriceCents)}</span> (carriers do not
            see it)
          </p>
        ) : null}
        {tender.awardedAt && tender.awardedBy ? (
          <p className="text-sm text-muted-foreground">
            Awarded {formatInZone(tender.awardedAt, timeZone)} by {tender.awardedBy.displayName}
          </p>
        ) : null}
      </Card>

      <Card className="p-5">
        <CardHeader>
          <CardTitle>Bids, cheapest first</CardTitle>
        </CardHeader>
        {tender.bids.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bids yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Carrier</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>vs. target</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tender.bids.map((bid) => {
                const diff =
                  tender.targetPriceCents === null
                    ? null
                    : bid.priceCents - tender.targetPriceCents;
                return (
                  <TableRow key={bid.id}>
                    <TableCell>
                      {bid.carrier.name}
                      {bid.source === "staff" ? (
                        <span className="text-xs text-muted-foreground"> (entered by you)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatUsd(bid.priceCents)}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {diff === null
                        ? "—"
                        : `${diff > 0 ? "+" : diff < 0 ? "-" : ""}${formatUsd(Math.abs(diff))}`}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{bid.note ?? ""}</TableCell>
                    <TableCell>{BID_STATUS[bid.status]}</TableCell>
                    <TableCell>
                      {canManage && open && bid.status === "submitted" ? (
                        <form action={awardBidAction.bind(null, tender.id)} className="flex gap-2">
                          <input type="hidden" name="bidId" value={bid.id} />
                          <Input
                            name="note"
                            aria-label="Reason (optional)"
                            placeholder="Reason"
                            className="h-8 w-32"
                          />
                          <Button type="submit" size="sm" variant="solid">
                            Award
                          </Button>
                        </form>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {open && live.length > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Loadlane never picks a bid for you. Awarding assigns the carrier to the transport and
            rejects the other valid bids.
          </p>
        ) : null}
      </Card>

      <Card className="p-5">
        <CardHeader>
          <CardTitle>Carriers invited</CardTitle>
        </CardHeader>
        <ul className="space-y-1 text-sm">
          {tender.invitations.map((invitation) => (
            <li key={invitation.id} className="flex justify-between gap-3">
              <span>{invitation.carrier.name}</span>
              <span className="text-muted-foreground">
                link {invitation.state}
                {invitation.state === "active"
                  ? `, valid until ${formatInZone(invitation.expiresAt, timeZone)}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {canManage && open ? (
        <>
          <form action={enterBidAction.bind(null, tender.id)}>
            <Card className="space-y-3 p-5">
              <h2 className="text-base font-semibold">
                Enter a price you received by phone or e-mail
              </h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <NativeSelect name="carrierId" required defaultValue="" aria-label="Carrier">
                  <option value="" disabled>
                    Carrier
                  </option>
                  {tender.invitations.map((invitation) => (
                    <option key={invitation.id} value={invitation.carrier.id}>
                      {invitation.carrier.name}
                    </option>
                  ))}
                </NativeSelect>
                <Input
                  name="price"
                  inputMode="decimal"
                  placeholder="$ 850.00"
                  required
                  aria-label="Price in dollars"
                />
                <Input name="note" placeholder="Note (optional)" aria-label="Note" />
              </div>
              <Button type="submit" variant="outline">
                Add bid
              </Button>
            </Card>
          </form>
          <form action={cancelTenderAction.bind(null, tender.id)}>
            <Button type="submit" variant="ghost">
              Cancel this offer
            </Button>
          </form>
        </>
      ) : null}
    </div>
  );
}
