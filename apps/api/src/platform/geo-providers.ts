import { ServiceUnavailableException } from "@nestjs/common";

// Geocoding (address to coordinates) and routing (distance and driving time) behind small interfaces
// (ADR 0021). The first adapter talks to OpenRouteService. Nothing here guesses: when a provider is
// missing or does not know the answer the caller gets that fact, never an invented value.

export interface GeocodeQuery {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /** The address as the provider understood it, shown to the person so a wrong match is noticed. */
  label: string;
}

export interface GeocodingProvider {
  readonly configured: boolean;
  /** null when the provider has no confident match. */
  geocode(query: GeocodeQuery): Promise<GeocodeResult | null>;
}

export interface RoutePoint {
  latitude: number;
  longitude: number;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  /** The driven line as [longitude, latitude] pairs. */
  geometry: [number, number][];
}

export type RoutingFailure = "no_route" | "rate_limited" | "provider_error";

/** The provider answered, but not with a route. Carries a stable code, never the provider's text. */
export class GeoProviderError extends Error {
  constructor(readonly code: RoutingFailure) {
    super(code);
  }
}

export interface RoutingProvider {
  readonly configured: boolean;
  /** A truck route from one point to another. Throws GeoProviderError when none can be given. */
  route(from: RoutePoint, to: RoutePoint): Promise<RouteResult>;
}

export interface OrsSettings {
  apiKey: string;
  /** Default https://api.openrouteservice.org. Tests point it at a local stub. */
  baseUrl: string;
}

/** A match below this confidence is treated as "not found": a wrong pin is worse than none. */
export const MIN_GEOCODE_CONFIDENCE = 0.6;

const TIMEOUT_MS = 10_000;

/** OpenRouteService: the geocoder (Pelias) and truck directions, with one API key. */
export class OrsGeocodingProvider implements GeocodingProvider {
  readonly configured = true;

  constructor(
    private readonly settings: OrsSettings,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async geocode(query: GeocodeQuery): Promise<GeocodeResult | null> {
    const text = `${query.addressLine1}, ${query.city}, ${query.state} ${query.postalCode}`;
    const url = new URL("/geocode/search", this.settings.baseUrl);
    url.searchParams.set("text", text);
    url.searchParams.set("boundary.country", "US");
    url.searchParams.set("size", "1");
    const response = await this.fetchFn(url, {
      headers: { authorization: this.settings.apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new GeoProviderError(failureOf(response.status));
    const body = (await response.json().catch(() => null)) as {
      features?: {
        geometry?: { coordinates?: unknown };
        properties?: { confidence?: unknown; label?: unknown };
      }[];
    } | null;
    const feature = body?.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    const [longitude, latitude] = coordinates as unknown[];
    const confidence = feature?.properties?.confidence;
    if (
      typeof longitude !== "number" ||
      typeof latitude !== "number" ||
      typeof confidence !== "number" ||
      confidence < MIN_GEOCODE_CONFIDENCE
    ) {
      return null;
    }
    const label = feature?.properties?.label;
    return { latitude, longitude, label: typeof label === "string" ? label : text };
  }
}

export class OrsRoutingProvider implements RoutingProvider {
  readonly configured = true;

  constructor(
    private readonly settings: OrsSettings,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async route(from: RoutePoint, to: RoutePoint): Promise<RouteResult> {
    const url = new URL("/v2/directions/driving-hgv/geojson", this.settings.baseUrl);
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        authorization: this.settings.apiKey,
        "content-type": "application/json",
        accept: "application/geo+json, application/json",
      },
      body: JSON.stringify({
        coordinates: [
          [from.longitude, from.latitude],
          [to.longitude, to.latitude],
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new GeoProviderError(failureOf(response.status));
    const body = (await response.json().catch(() => null)) as {
      features?: {
        geometry?: { coordinates?: unknown };
        properties?: { summary?: { distance?: unknown; duration?: unknown } };
      }[];
    } | null;
    const feature = body?.features?.[0];
    const distance = feature?.properties?.summary?.distance;
    const duration = feature?.properties?.summary?.duration;
    if (typeof distance !== "number" || typeof duration !== "number") {
      throw new GeoProviderError("provider_error");
    }
    const line = feature?.geometry?.coordinates;
    const geometry = Array.isArray(line)
      ? line.filter(
          (point): point is [number, number] =>
            Array.isArray(point) && typeof point[0] === "number" && typeof point[1] === "number",
        )
      : [];
    return { distanceMeters: distance, durationSeconds: duration, geometry };
  }
}

function failureOf(status: number): RoutingFailure {
  if (status === 429) return "rate_limited";
  // 404 is "no route found", 400 usually "point not near a road": both mean this pair cannot be routed.
  if (status === 404 || status === 400) return "no_route";
  return "provider_error";
}

function unavailable(code: string, message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({ statusCode: 503, code, message });
}

export class UnconfiguredGeocodingProvider implements GeocodingProvider {
  readonly configured = false;
  geocode(): Promise<GeocodeResult | null> {
    return Promise.reject(
      unavailable("geocoding_not_configured", "Address lookup is not configured on this server."),
    );
  }
}

export class UnconfiguredRoutingProvider implements RoutingProvider {
  readonly configured = false;
  route(): Promise<RouteResult> {
    return Promise.reject(
      unavailable("routing_not_configured", "Routing is not configured on this server."),
    );
  }
}

/** Answers from a table, for tests only. MOCK: no coordinates or routes come from a real provider. */
export class MemoryGeocodingProvider implements GeocodingProvider {
  readonly configured = true;
  readonly queries: GeocodeQuery[] = [];
  constructor(private readonly known: Map<string, GeocodeResult> = new Map()) {}

  /** Teach the stub an address, keyed by "addressLine1|city". */
  set(addressLine1: string, city: string, result: GeocodeResult): void {
    this.known.set(`${addressLine1}|${city}`, result);
  }

  geocode(query: GeocodeQuery): Promise<GeocodeResult | null> {
    this.queries.push(query);
    return Promise.resolve(this.known.get(`${query.addressLine1}|${query.city}`) ?? null);
  }
}

/** Answers with a configured result, for tests only. MOCK: not a real route. */
export class MemoryRoutingProvider implements RoutingProvider {
  readonly configured = true;
  readonly calls: { from: RoutePoint; to: RoutePoint }[] = [];
  /** Set to make the next calls fail with this code. */
  failWith: RoutingFailure | undefined;
  result: RouteResult = { distanceMeters: 100_000, durationSeconds: 3_600, geometry: [] };

  route(from: RoutePoint, to: RoutePoint): Promise<RouteResult> {
    this.calls.push({ from, to });
    if (this.failWith) return Promise.reject(new GeoProviderError(this.failWith));
    return Promise.resolve(this.result);
  }
}
