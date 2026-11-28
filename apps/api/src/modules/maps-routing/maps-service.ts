import {
  BadGatewayException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import {
  etaIsCurrent,
  positionAgeMs,
  positionFreshness,
  type PositionFreshness,
} from "@loadlane/shared";
import type pg from "pg";
import { GeoProviderError, type GeocodingProvider } from "../../platform/geo-providers.ts";

export interface MapsContext {
  organizationId: string;
  userId: string;
  requestId?: string | undefined;
}

export interface LocationCoordinates {
  locationId: string;
  latitude: number;
  longitude: number;
  geocodedAt: string;
  source: "provider" | "manual";
  /** The address as the provider understood it, so a wrong match is noticed. Only for provider results. */
  matchedLabel: string | null;
}

export interface MapStop {
  sequence: number;
  type: "pickup" | "delivery";
  locationId: string;
  placeName: string;
  city: string;
  state: string;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  /** null until the location has coordinates. */
  latitude: number | null;
  longitude: number | null;
}

export interface MapTransport {
  id: string;
  reference: string;
  status: string;
  customerReference: string | null;
  stops: MapStop[];
  /** The last position a consenting driver reported. null when none exists: never estimated. */
  lastPosition: {
    latitude: number;
    longitude: number;
    recordedAt: string;
    ageMs: number;
    freshness: PositionFreshness;
    lowQuality: boolean;
  } | null;
  /** From a routing provider, only while current. Driving time only: no traffic or breaks. */
  estimatedArrival: string | null;
}

export interface MapData {
  generatedAt: string;
  transports: MapTransport[];
  /** Locations of these transports without coordinates, so the page can say why a stop is missing. */
  locationsWithoutCoordinates: { id: string; name: string; city: string; state: string }[];
}

type Row = Record<string, unknown>;

const TERMINAL_STATUSES = ["delivered", "completed", "cancelled"];
const MAX_TRANSPORTS = 500;

export function transportReference(number: unknown): string {
  return `LL-${String(Number(number)).padStart(6, "0")}`;
}

/** Coordinates of locations and the data behind the map page (ADR 0021). */
export class MapsService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly geocoder: GeocodingProvider,
  ) {}

  /** Looks the address up with the provider and stores the match. A weak or missing match stores nothing. */
  async geocode(context: MapsContext, locationId: string): Promise<LocationCoordinates> {
    const address = await withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const result = await client.query<Row>(
        "SELECT address_line1, city, state, postal_code FROM location WHERE id = $1",
        [locationId],
      );
      return result.rows[0];
    });
    if (!address) throw new NotFoundException();
    let match;
    try {
      match = await this.geocoder.geocode({
        addressLine1: address["address_line1"] as string,
        city: address["city"] as string,
        state: address["state"] as string,
        postalCode: address["postal_code"] as string,
      });
    } catch (error) {
      if (error instanceof GeoProviderError) {
        throw new BadGatewayException({
          statusCode: 502,
          code: error.code === "rate_limited" ? "geocoding_rate_limited" : "geocoding_failed",
          message:
            "The address lookup service did not answer. Try again later or enter the coordinates yourself.",
        });
      }
      throw error;
    }
    if (!match) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        code: "address_not_found",
        message:
          "The lookup service has no confident match for this address. Check the address or enter the coordinates yourself.",
      });
    }
    const stored = await this.store(
      context,
      locationId,
      match.latitude,
      match.longitude,
      "provider",
    );
    return { ...stored, matchedLabel: match.label };
  }

  /** Coordinates a person typed. They replace whatever was stored and are marked as manual. */
  async setManual(
    context: MapsContext,
    locationId: string,
    latitude: number,
    longitude: number,
  ): Promise<LocationCoordinates> {
    const stored = await this.store(context, locationId, latitude, longitude, "manual");
    return { ...stored, matchedLabel: null };
  }

  private async store(
    context: MapsContext,
    locationId: string,
    latitude: number,
    longitude: number,
    source: "provider" | "manual",
  ): Promise<Omit<LocationCoordinates, "matchedLabel">> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const updated = await client.query<Row>(
        `UPDATE location SET latitude = $2, longitude = $3, geocoded_at = now(), geocode_source = $4
         WHERE id = $1 RETURNING geocoded_at`,
        [locationId, latitude, longitude, source],
      );
      const row = updated.rows[0];
      if (!row) throw new NotFoundException();
      await client.query(
        `INSERT INTO audit_log (organization_id, actor_type, actor_user_id, action, entity_type, entity_id, changes, request_id)
         VALUES ($1, 'user', $2, $3, 'location', $4, $5, $6)`,
        [
          context.organizationId,
          context.userId,
          source === "provider" ? "location.geocoded" : "location.coordinates_set",
          locationId,
          JSON.stringify({ source }),
          context.requestId ?? null,
        ],
      );
      return {
        locationId,
        latitude,
        longitude,
        geocodedAt: (row["geocoded_at"] as Date).toISOString(),
        source,
      };
    });
  }

  /** Open transports with their stops and the last reported position of each. */
  async mapData(context: MapsContext, now: Date = new Date()): Promise<MapData> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const transports = await client.query<Row>(
        `SELECT t.id, t.number, t.status, t.customer_reference,
                lp.latitude AS lp_latitude, lp.longitude AS lp_longitude, lp.recorded_at AS lp_recorded_at,
                lp.low_quality AS lp_low_quality,
                e.eta_at, e.computed_at AS eta_computed_at
         FROM transport t
         LEFT JOIN last_position lp ON lp.transport_id = t.id AND lp.organization_id = t.organization_id
         LEFT JOIN eta_estimate e ON e.transport_id = t.id AND e.organization_id = t.organization_id
         WHERE t.status <> ALL($1::transport_status[])
         ORDER BY t.number DESC
         LIMIT $2`,
        [TERMINAL_STATUSES, MAX_TRANSPORTS],
      );
      const ids = transports.rows.map((row) => row["id"] as string);
      const stops = await client.query<Row>(
        `SELECT s.transport_id, s.sequence, s.type, s.window_start, s.window_end,
                l.id AS location_id, l.name, l.city, l.state, l.timezone, l.latitude, l.longitude
         FROM stop s JOIN location l ON l.id = s.location_id AND l.organization_id = s.organization_id
         WHERE s.transport_id = ANY($1::uuid[])
         ORDER BY s.transport_id, s.sequence`,
        [ids],
      );
      const byTransport = new Map<string, MapStop[]>();
      const missing = new Map<string, { id: string; name: string; city: string; state: string }>();
      for (const row of stops.rows) {
        const latitude = row["latitude"] as number | null;
        const longitude = row["longitude"] as number | null;
        const stop: MapStop = {
          sequence: row["sequence"] as number,
          type: row["type"] as "pickup" | "delivery",
          locationId: row["location_id"] as string,
          placeName: row["name"] as string,
          city: row["city"] as string,
          state: row["state"] as string,
          windowStart: (row["window_start"] as Date).toISOString(),
          windowEnd: (row["window_end"] as Date).toISOString(),
          timezone: row["timezone"] as string,
          latitude,
          longitude,
        };
        const list = byTransport.get(row["transport_id"] as string) ?? [];
        list.push(stop);
        byTransport.set(row["transport_id"] as string, list);
        if (latitude === null) {
          missing.set(stop.locationId, {
            id: stop.locationId,
            name: stop.placeName,
            city: stop.city,
            state: stop.state,
          });
        }
      }
      return {
        generatedAt: now.toISOString(),
        transports: transports.rows.map((row) => {
          const recordedAt = row["lp_recorded_at"] as Date | null;
          return {
            id: row["id"] as string,
            reference: transportReference(row["number"]),
            status: row["status"] as string,
            customerReference: row["customer_reference"] as string | null,
            stops: byTransport.get(row["id"] as string) ?? [],
            lastPosition: recordedAt
              ? {
                  latitude: row["lp_latitude"] as number,
                  longitude: row["lp_longitude"] as number,
                  recordedAt: recordedAt.toISOString(),
                  ageMs: positionAgeMs(recordedAt, now),
                  freshness: positionFreshness(recordedAt, now),
                  lowQuality: row["lp_low_quality"] === true,
                }
              : null,
            estimatedArrival:
              row["eta_at"] && etaIsCurrent(row["eta_computed_at"] as Date, now)
                ? (row["eta_at"] as Date).toISOString()
                : null,
          };
        }),
        locationsWithoutCoordinates: [...missing.values()],
      };
    });
  }

  private tenant(context: MapsContext) {
    return { organizationId: context.organizationId, userId: context.userId };
  }
}
