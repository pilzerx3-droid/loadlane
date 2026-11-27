import {
  FRESHNESS_LABELS,
  describeAge,
  formatInZone,
  positionAgeMs,
  positionFreshness,
  type PositionFreshness,
} from "@loadlane/shared";
import { Card, CardHeader, CardTitle } from "@loadlane/ui";
import type { TransportDetail } from "../lib/transport-api";

const FRESHNESS_STYLES: Record<PositionFreshness, string> = {
  fresh: "border-success text-success",
  aging: "border-warning text-warning",
  stale: "border-danger text-danger",
};

/**
 * The last position a driver shared, always with the time the phone took it and how old that is.
 * Outdated positions are marked as such; without a position the card says so. Nothing is estimated.
 */
export function LastPositionCard({
  position,
  timeZone,
  now,
}: {
  position: TransportDetail["lastPosition"];
  timeZone: string;
  now: Date;
}) {
  return (
    <Card className="p-5">
      <CardHeader>
        <CardTitle>Last known position</CardTitle>
      </CardHeader>
      {position === null ? (
        <p className="text-sm text-muted-foreground">
          No position received. A position appears here after the driver opens their link and agrees
          to share it.
        </p>
      ) : (
        <PositionDetails position={position} timeZone={timeZone} now={now} />
      )}
    </Card>
  );
}

function PositionDetails({
  position,
  timeZone,
  now,
}: {
  position: NonNullable<TransportDetail["lastPosition"]>;
  timeZone: string;
  now: Date;
}) {
  const freshness = positionFreshness(position.recordedAt, now);
  return (
    <div className="space-y-1.5 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-control border px-2 py-0.5 text-xs font-semibold ${FRESHNESS_STYLES[freshness]}`}
        >
          {FRESHNESS_LABELS[freshness]}
        </span>
        <span className="font-mono">
          {position.latitude.toFixed(5)}, {position.longitude.toFixed(5)}
        </span>
      </p>
      <p>
        Reported by the driver&apos;s phone at {formatInZone(position.recordedAt, timeZone)} (
        {describeAge(positionAgeMs(position.recordedAt, now))})
      </p>
      {position.accuracyM !== null ? (
        <p className="text-muted-foreground">
          Accuracy about {Math.round(position.accuracyM)} m
          {position.lowQuality ? " — too coarse to rely on" : ""}
        </p>
      ) : null}
      {freshness === "stale" ? (
        <p className="text-muted-foreground">
          This position is old. The driver may have closed the page or lost their connection.
        </p>
      ) : null}
    </div>
  );
}
