import { Truck } from "lucide-react";
import { z } from "zod";
import { TRANSPORT_STATUSES } from "@loadlane/shared";
import { Card, CardDescription, CardHeader, CardTitle, EmptyState } from "@loadlane/ui";
import { statusLabel } from "./transport-views";

export const summarySchema = z.object({
  total: z.number(),
  byStatus: z.record(z.string(), z.number()),
  active: z.number(),
  open: z.number(),
  withoutCarrier: z.number(),
  pickupsNext24Hours: z.number(),
  deliveredLast7Days: z.number(),
  withoutPosition: z.number(),
});

export type Summary = z.infer<typeof summarySchema>;

/** Offers and quotes waiting for a decision. A field is undefined when the person may not see it. */
export interface CommercialCounts {
  openOffers?: number | undefined;
  offersWithBids?: number | undefined;
  offersPastDeadline?: number | undefined;
  quotesAwaitingAnswer?: number | undefined;
  quotesExpired?: number | undefined;
}

function Stat({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: number;
  href?: string;
  hint?: string;
}) {
  const content = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-3xl font-semibold tracking-tight">
        {value.toLocaleString("en-US")}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </>
  );
  return (
    <Card className="p-4">
      {href ? (
        <a href={href} className="block hover:underline">
          {content}
        </a>
      ) : (
        content
      )}
    </Card>
  );
}

/** Counts from stored transports. Nothing here is estimated or simulated. */
export function Dashboard({
  summary,
  canManage,
  commercial,
}: {
  summary: Summary;
  canManage: boolean;
  commercial?: CommercialCounts;
}) {
  if (summary.total === 0) {
    return (
      <EmptyState
        icon={<Truck aria-hidden="true" />}
        title="No transports yet"
        description={
          canManage
            ? "Create your first transport or import a CSV file. The numbers here come from your transports."
            : "Nobody has created a transport yet."
        }
        action={
          canManage ? (
            <a href="/transports/new" className="text-sm underline">
              New transport
            </a>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Active"
          value={summary.active}
          href="/transports?status=assigned,confirmed,loading,in_transit,at_destination,unloading"
          hint="Assigned until unloading"
        />
        <Stat
          label="Open"
          value={summary.open}
          href="/transports?status=created,planned"
          hint="Created or planned"
        />
        <Stat
          label="Without a carrier"
          value={summary.withoutCarrier}
          hint="Not delivered or cancelled"
        />
        <Stat
          label="Pickups in 24 hours"
          value={summary.pickupsNext24Hours}
          hint="First stop, not on the road yet"
        />
        <Stat label="Delivered, last 7 days" value={summary.deliveredLast7Days} />
        <Stat
          label="On the road, no position"
          value={summary.withoutPosition}
          hint="Loading up to unloading, nothing shared by a driver yet"
        />
      </div>
      {commercial &&
      (commercial.openOffers !== undefined || commercial.quotesAwaitingAnswer !== undefined) ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Waiting for a decision">
          {commercial.openOffers !== undefined ? (
            <Stat
              label="Open spot offers"
              value={commercial.openOffers}
              href="/spot"
              hint={`${commercial.offersWithBids ?? 0} with bids`}
            />
          ) : null}
          {commercial.offersPastDeadline !== undefined ? (
            <Stat
              label="Offers past their deadline"
              value={commercial.offersPastDeadline}
              href="/spot"
              hint="Still open: decide or cancel"
            />
          ) : null}
          {commercial.quotesAwaitingAnswer !== undefined ? (
            <Stat
              label="Quotes awaiting an answer"
              value={commercial.quotesAwaitingAnswer}
              href="/quotes"
              hint="Sent and still valid"
            />
          ) : null}
          {commercial.quotesExpired !== undefined ? (
            <Stat
              label="Quotes expired"
              value={commercial.quotesExpired}
              href="/quotes"
              hint="Sent, validity date passed"
            />
          ) : null}
        </div>
      ) : null}
      <Card className="p-5">
        <CardHeader>
          <CardTitle>All transports by status</CardTitle>
          <CardDescription>{summary.total} in total</CardDescription>
        </CardHeader>
        <ul className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {TRANSPORT_STATUSES.map((status) => (
            <li key={status} className="flex justify-between gap-3">
              <a href={`/transports?status=${status}`} className="hover:underline">
                {statusLabel(status)}
              </a>
              <span className="font-mono">{summary.byStatus[status] ?? 0}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-4 text-sm text-muted-foreground">
        Late transports are not shown yet: they need an ETA, which comes in a later phase. Positions
        shown in Loadlane come only from drivers who agreed to share them. Loadlane does not
        estimate either.
      </Card>
    </div>
  );
}
