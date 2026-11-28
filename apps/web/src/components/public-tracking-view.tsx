import {
  TRANSPORT_STATUS_LABELS,
  formatInZone,
  formatWindow,
  isTransportStatus,
} from "@loadlane/shared";
import type { PublicTracking } from "../lib/tracking-links";

function label(status: string): string {
  return isTransportStatus(status) ? TRANSPORT_STATUS_LABELS[status] : status;
}

/** What a customer sees: status, planned windows and history. No prices, no carrier, no position. */
export function PublicTrackingView({ tracking }: { tracking: PublicTracking }) {
  const zone = tracking.stops[0]?.timezone ?? "UTC";
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Shipment</p>
        <h1 className="text-2xl font-semibold">{tracking.reference}</h1>
        {tracking.customerReference ? (
          <p className="text-sm text-muted-foreground">
            Your reference: {tracking.customerReference}
          </p>
        ) : null}
        <p className="mt-2 inline-block rounded-control border border-border px-3 py-1 text-sm font-medium">
          {label(tracking.status)}
        </p>
      </div>

      <section aria-label="Stops" className="space-y-3">
        <h2 className="text-lg font-semibold">Planned stops</h2>
        <ol className="space-y-3">
          {tracking.stops.map((stop) => (
            <li key={stop.sequence} className="rounded-control border border-border p-3 text-sm">
              <p className="font-semibold">
                {stop.type === "pickup" ? "Pickup" : "Delivery"} · {stop.placeName}
              </p>
              <p>
                {stop.city}, {stop.state}
              </p>
              <p className="text-muted-foreground">
                {formatWindow(stop.windowStart, stop.windowEnd, stop.timezone)} (local time)
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="History" className="space-y-3">
        <h2 className="text-lg font-semibold">Status history</h2>
        <ul className="space-y-1.5 text-sm">
          {[...tracking.history].reverse().map((entry) => (
            <li key={`${entry.status}-${entry.occurredAt}`} className="flex justify-between gap-3">
              <span>{label(entry.status)}</span>
              <span className="text-muted-foreground">{formatInZone(entry.occurredAt, zone)}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-muted-foreground">
        This page shows planned times and reported statuses. Live vehicle positions are not shown.
      </p>
    </div>
  );
}
