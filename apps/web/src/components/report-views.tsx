import { formatPercent, formatUsd } from "@loadlane/shared";
import { Card, CardDescription, CardHeader, CardTitle } from "@loadlane/ui";
import { PERIODS, type CommercialReport } from "../lib/reports";

const pct = (bp: number | null) => (bp === null ? "n/a" : formatPercent(bp));
const money = (cents: number | null) => (cents === null ? "n/a" : formatUsd(cents));

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt>
        {label}
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

/** Figures from stored data. "n/a" means there is nothing to divide by; nothing is estimated. */
export function CommercialReportView({
  report,
  selected,
}: {
  report: CommercialReport;
  selected: string;
}) {
  const { spot, quotes, deliveries } = report;
  return (
    <div className="space-y-5">
      <nav aria-label="Period" className="flex flex-wrap gap-2 text-sm">
        {PERIODS.map((period) => (
          <a
            key={period.key}
            href={`/reports?period=${period.key}`}
            aria-current={selected === period.key ? "page" : undefined}
            className={`rounded-control border px-3 py-1.5 ${
              selected === period.key ? "border-foreground" : "border-border text-muted-foreground"
            }`}
          >
            {period.label}
          </a>
        ))}
        <span className="px-1 py-1.5 text-muted-foreground">
          {report.period.from} to {report.period.to}
        </span>
      </nav>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <CardHeader>
            <CardTitle>Spot freight</CardTitle>
            <CardDescription>Offers created in the period</CardDescription>
          </CardHeader>
          <dl className="divide-y divide-border">
            <Row label="Offers" value={String(spot.offers)} />
            <Row label="Awarded" value={String(spot.awarded)} />
            <Row label="Cancelled" value={String(spot.cancelled)} />
            <Row label="Still open" value={String(spot.stillOpen)} />
            <Row
              label="Award rate"
              value={pct(spot.awardRateBp)}
              hint="Awarded of offers no longer open"
            />
            <Row
              label="Carriers bidding per offer"
              value={spot.bidsPerOffer === null ? "n/a" : spot.bidsPerOffer.toFixed(2)}
            />
            <Row label="Average awarded price" value={money(spot.averageAwardedPriceCents)} />
            <Row
              label="Against target price"
              value={
                spot.offersWithTarget === 0
                  ? "n/a"
                  : `${spot.belowTargetCents >= 0 ? "" : "+"}${formatUsd(Math.abs(spot.belowTargetCents))} ${spot.belowTargetCents >= 0 ? "below" : "above"}`
              }
              hint={`${spot.offersWithTarget} awarded offers had a target`}
            />
          </dl>
        </Card>

        <Card className="p-5">
          <CardHeader>
            <CardTitle>Quotes</CardTitle>
            <CardDescription>Quotes created in the period</CardDescription>
          </CardHeader>
          <dl className="divide-y divide-border">
            <Row label="Created" value={String(quotes.created)} />
            <Row label="Sent" value={String(quotes.sent)} hint="Sent, accepted or rejected" />
            <Row label="Accepted" value={String(quotes.accepted)} />
            <Row label="Rejected" value={String(quotes.rejected)} />
            <Row
              label="Acceptance rate"
              value={pct(quotes.acceptanceRateBp)}
              hint="Accepted of decided"
            />
            <Row label="Accepted value" value={formatUsd(quotes.acceptedValueCents)} />
            <Row
              label="Contribution"
              value={formatUsd(quotes.acceptedContributionCents)}
              hint="From the calculations behind accepted quotes"
            />
            <Row label="Margin (on price)" value={pct(quotes.acceptedMarginBp)} />
          </dl>
        </Card>

        <Card className="p-5">
          <CardHeader>
            <CardTitle>Deliveries</CardTitle>
            <CardDescription>Transports delivered in the period</CardDescription>
          </CardHeader>
          <dl className="divide-y divide-border">
            <Row label="Delivered" value={String(deliveries.delivered)} />
            <Row label="With a delivery window" value={String(deliveries.withDeliveryWindow)} />
            <Row
              label="On time"
              value={String(deliveries.onTime)}
              hint="Delivered by the end of the last delivery window"
            />
            <Row label="On-time rate" value={pct(deliveries.onTimeRateBp)} />
          </dl>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">{report.note}</p>
    </div>
  );
}
