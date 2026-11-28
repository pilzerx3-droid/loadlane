import { describeAge, formatInZone, positionAgeMs } from "@loadlane/shared";
import { Card, CardHeader, CardTitle } from "@loadlane/ui";
import { z } from "zod";

export const etaSchema = z.object({
  estimate: z
    .object({
      estimatedArrival: z.string(),
      computedAt: z.string(),
      basedOnPositionAt: z.string(),
      distanceMiles: z.number(),
      drivingMinutes: z.number(),
      provider: z.string(),
      excludesTrafficAndBreaks: z.literal(true),
    })
    .nullable(),
  routingConfigured: z.boolean(),
});

export type EtaInfo = z.infer<typeof etaSchema>;

function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest} min` : `${hours} h ${rest} min`;
}

/**
 * The estimated arrival at the final stop. It says where it comes from and what it leaves out: it is
 * driving time from the last reported position, without traffic, rest breaks or waiting. Without a
 * current estimate the card says why instead of showing a made-up time.
 */
export function EtaCard({
  eta,
  windowEnd,
  timeZone,
  now,
}: {
  eta: EtaInfo;
  /** End of the final delivery window, ISO. */
  windowEnd: string | null;
  timeZone: string;
  now: Date;
}) {
  const estimate = eta.estimate;
  return (
    <Card className="p-5">
      <CardHeader>
        <CardTitle>Estimated arrival</CardTitle>
      </CardHeader>
      {estimate === null ? (
        <p className="text-sm text-muted-foreground">
          {eta.routingConfigured
            ? "No current estimate. One is calculated when a driver who agreed to share a recent position is on the way and the final stop has map coordinates."
            : "Not available: no routing service is set up on this server (ORS_API_KEY)."}
        </p>
      ) : (
        <div className="space-y-1.5 text-sm">
          <p className="text-base font-semibold">
            {formatInZone(estimate.estimatedArrival, timeZone)}
            {windowEnd && new Date(estimate.estimatedArrival) > new Date(windowEnd) ? (
              <span className="ml-2 rounded-control border border-danger px-2 py-0.5 text-xs font-semibold text-danger">
                After the delivery window
              </span>
            ) : null}
          </p>
          <p>
            About {estimate.distanceMiles} mi, {duration(estimate.drivingMinutes)} of driving from
            the position reported {describeAge(positionAgeMs(estimate.basedOnPositionAt, now))}.
          </p>
          <p className="text-muted-foreground">
            Calculated {describeAge(positionAgeMs(estimate.computedAt, now))} by OpenRouteService.
            Driving time only: traffic, rest breaks and waiting are not included.
          </p>
        </div>
      )}
    </Card>
  );
}
