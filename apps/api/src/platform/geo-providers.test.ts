// The OpenRouteService adapters against a local stub server that answers in the documented shapes
// (GeoJSON from the geocoder, GeoJSON directions). This proves our parsing and failure handling.
// It does not prove the live service: no call with a real key has been made yet (ADR 0021).
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GeoProviderError,
  MIN_GEOCODE_CONFIDENCE,
  OrsGeocodingProvider,
  OrsRoutingProvider,
} from "./geo-providers.ts";

interface Seen {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

let server: Server;
let baseUrl = "";
const seen: Seen[] = [];
let handler: (request: IncomingMessage) => { status: number; body: unknown } = () => ({
  status: 500,
  body: {},
});

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      seen.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString(),
      });
      const answer = handler(request);
      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

const settings = () => ({ apiKey: "test-key-1234567890", baseUrl });
const address = {
  addressLine1: "1 Main St",
  city: "Dallas",
  state: "TX",
  postalCode: "75201",
};

describe("OrsGeocodingProvider", () => {
  it("asks for one US match, sends the key in a header and returns coordinates", async () => {
    seen.length = 0;
    handler = () => ({
      status: 200,
      body: {
        features: [
          {
            geometry: { coordinates: [-96.797, 32.776] },
            properties: { confidence: 1, label: "1 Main St, Dallas, TX, USA" },
          },
        ],
      },
    });
    const result = await new OrsGeocodingProvider(settings()).geocode(address);
    expect(result).toEqual({
      latitude: 32.776,
      longitude: -96.797,
      label: "1 Main St, Dallas, TX, USA",
    });
    const request = seen[0];
    expect(request?.authorization).toBe("test-key-1234567890");
    const url = new URL(request?.url ?? "", baseUrl);
    expect(url.pathname).toBe("/geocode/search");
    expect(url.searchParams.get("text")).toBe("1 Main St, Dallas, TX 75201");
    expect(url.searchParams.get("boundary.country")).toBe("US");
    expect(url.searchParams.get("size")).toBe("1");
    expect(request?.url).not.toContain("test-key");
  });

  it("returns null for no match, a weak match or an odd answer", async () => {
    const provider = new OrsGeocodingProvider(settings());
    handler = () => ({ status: 200, body: { features: [] } });
    expect(await provider.geocode(address)).toBeNull();
    handler = () => ({
      status: 200,
      body: {
        features: [
          {
            geometry: { coordinates: [-96.8, 32.8] },
            properties: { confidence: MIN_GEOCODE_CONFIDENCE - 0.1, label: "Dallas, TX" },
          },
        ],
      },
    });
    expect(await provider.geocode(address)).toBeNull();
    handler = () => ({
      status: 200,
      body: { features: [{ geometry: { coordinates: ["x", "y"] }, properties: {} }] },
    });
    expect(await provider.geocode(address)).toBeNull();
  });

  it("raises a coded error when the service refuses", async () => {
    const provider = new OrsGeocodingProvider(settings());
    handler = () => ({ status: 429, body: {} });
    await expect(provider.geocode(address)).rejects.toMatchObject({ code: "rate_limited" });
    handler = () => ({ status: 500, body: {} });
    await expect(provider.geocode(address)).rejects.toBeInstanceOf(GeoProviderError);
  });
});

describe("OrsRoutingProvider", () => {
  it("posts longitude/latitude pairs to the truck profile and reads distance, time and line", async () => {
    seen.length = 0;
    handler = () => ({
      status: 200,
      body: {
        features: [
          {
            properties: { summary: { distance: 386_000.5, duration: 14_400.2 } },
            geometry: {
              coordinates: [
                [-96.8, 32.8],
                [-95.4, 29.8],
              ],
            },
          },
        ],
      },
    });
    const result = await new OrsRoutingProvider(settings()).route(
      { latitude: 32.8, longitude: -96.8 },
      { latitude: 29.8, longitude: -95.4 },
    );
    expect(result).toEqual({
      distanceMeters: 386_000.5,
      durationSeconds: 14_400.2,
      geometry: [
        [-96.8, 32.8],
        [-95.4, 29.8],
      ],
    });
    const request = seen[0];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("/v2/directions/driving-hgv/geojson");
    expect(request?.authorization).toBe("test-key-1234567890");
    expect(JSON.parse(request?.body ?? "{}")).toEqual({
      coordinates: [
        [-96.8, 32.8],
        [-95.4, 29.8],
      ],
    });
  });

  it("maps failures to stable codes and rejects an answer without a summary", async () => {
    const provider = new OrsRoutingProvider(settings());
    const from = { latitude: 1, longitude: 1 };
    const to = { latitude: 2, longitude: 2 };
    for (const [status, code] of [
      [404, "no_route"],
      [400, "no_route"],
      [429, "rate_limited"],
      [503, "provider_error"],
    ] as const) {
      handler = () => ({ status, body: {} });
      await expect(provider.route(from, to)).rejects.toMatchObject({ code });
    }
    handler = () => ({ status: 200, body: { features: [{ properties: {} }] } });
    await expect(provider.route(from, to)).rejects.toMatchObject({ code: "provider_error" });
  });
});
