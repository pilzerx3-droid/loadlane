import { TRANSPORT_STATUS_LABELS, formatWindow, isTransportStatus } from "@loadlane/shared";
import type { DriverJobView as Job } from "../lib/driver-api";

/** The job as the driver sees it: where to go and when. No customer, no prices. */
export function DriverJobView({ job }: { job: Job }) {
  const statusLabel = isTransportStatus(job.status)
    ? TRANSPORT_STATUS_LABELS[job.status]
    : job.status;
  return (
    <section aria-label="Your job" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">{job.reference}</h1>
        <span className="rounded-control border border-border px-2.5 py-1 text-sm">
          {statusLabel}
        </span>
      </div>
      <ol className="space-y-3">
        {job.stops.map((stop) => (
          <li key={stop.sequence} className="rounded-control border border-border p-3 text-sm">
            <p className="font-semibold">
              {stop.sequence}. {stop.type === "pickup" ? "Pickup" : "Delivery"} ·{" "}
              {stop.location.name}
            </p>
            <p>
              {stop.location.addressLine1}
              {stop.location.addressLine2 ? `, ${stop.location.addressLine2}` : ""},{" "}
              {stop.location.city}, {stop.location.state} {stop.location.postalCode}
            </p>
            <p className="text-muted-foreground">
              {formatWindow(stop.windowStart, stop.windowEnd, stop.location.timezone)} (local time)
            </p>
            {stop.reference ? <p>Reference: {stop.reference}</p> : null}
            {stop.notes ? <p className="text-muted-foreground">{stop.notes}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
