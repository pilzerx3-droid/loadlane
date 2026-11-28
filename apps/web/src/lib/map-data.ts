import { z } from "zod";

const stopSchema = z.object({
  sequence: z.number(),
  type: z.enum(["pickup", "delivery"]),
  locationId: z.string(),
  placeName: z.string(),
  city: z.string(),
  state: z.string(),
  windowStart: z.string(),
  windowEnd: z.string(),
  timezone: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});

export const mapDataSchema = z.object({
  generatedAt: z.string(),
  transports: z.array(
    z.object({
      id: z.string(),
      reference: z.string(),
      status: z.string(),
      customerReference: z.string().nullable(),
      stops: z.array(stopSchema),
      lastPosition: z
        .object({
          latitude: z.number(),
          longitude: z.number(),
          recordedAt: z.string(),
          ageMs: z.number(),
          freshness: z.enum(["fresh", "aging", "stale"]),
          lowQuality: z.boolean(),
        })
        .nullable(),
    }),
  ),
  locationsWithoutCoordinates: z.array(
    z.object({ id: z.string(), name: z.string(), city: z.string(), state: z.string() }),
  ),
});

export type MapData = z.infer<typeof mapDataSchema>;
export type MapTransport = MapData["transports"][number];
export type MapStop = MapTransport["stops"][number];

export interface MapPoint {
  kind: "pickup" | "delivery" | "position";
  latitude: number;
  longitude: number;
  title: string;
  detail: string;
  /** For positions: how fresh the report is. */
  freshness?: "fresh" | "aging" | "stale";
  transportId: string;
}

/**
 * Everything the map can draw, as plain points: the stops that have coordinates and the last
 * reported positions. Nothing is estimated: a transport without a report has no position marker.
 */
export function mapPoints(
  data: MapData,
  describeAge: (ageMs: number) => string,
  freshnessLabel: (freshness: "fresh" | "aging" | "stale") => string,
): MapPoint[] {
  const points: MapPoint[] = [];
  for (const transport of data.transports) {
    for (const stop of transport.stops) {
      if (stop.latitude === null || stop.longitude === null) continue;
      points.push({
        kind: stop.type,
        latitude: stop.latitude,
        longitude: stop.longitude,
        title: `${transport.reference} · ${stop.type === "pickup" ? "Pickup" : "Delivery"}`,
        detail: `${stop.placeName}, ${stop.city}, ${stop.state}`,
        transportId: transport.id,
      });
    }
    const position = transport.lastPosition;
    if (position) {
      points.push({
        kind: "position",
        latitude: position.latitude,
        longitude: position.longitude,
        title: `${transport.reference} · last known position`,
        detail: `Reported ${describeAge(position.ageMs)} (${freshnessLabel(position.freshness)})${
          position.lowQuality ? ", low accuracy" : ""
        }`,
        freshness: position.freshness,
        transportId: transport.id,
      });
    }
  }
  return points;
}
