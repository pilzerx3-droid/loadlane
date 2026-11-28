import { describe, expect, it, vi } from "vitest";
import type { AuthDeps } from "./auth-routes";
import { geocodeLocation, parseCoordinate, setLocationCoordinates } from "./location-geo";

vi.mock("./auth-routes", () => ({
  loadSession: (sessionId: string | undefined) =>
    Promise.resolve(
      sessionId === "s1" ? { accessToken: "jwt", activeOrganizationId: "org-1" } : undefined,
    ),
}));

const deps = {
  config: { apiUrl: "http://api.test" },
  log: () => undefined,
} as unknown as AuthDeps;

function respond(status: number, body: unknown, capture?: (call: [string, string]) => void) {
  const fake: typeof fetch = (url, init) => {
    capture?.([typeof url === "string" ? url : "", init?.method ?? "GET"]);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return fake;
}

describe("location coordinates", () => {
  it("calls the lookup and the manual endpoint with the right methods", async () => {
    const calls: [string, string][] = [];
    const ok = { latitude: 32.7, longitude: -96.8 };
    expect(
      await geocodeLocation(
        "s1",
        "loc",
        deps,
        respond(200, ok, (call) => calls.push(call)),
      ),
    ).toEqual({ status: "done" });
    expect(
      await setLocationCoordinates(
        "s1",
        "loc",
        32.7,
        -96.8,
        deps,
        respond(200, ok, (call) => calls.push(call)),
      ),
    ).toEqual({ status: "done" });
    expect(calls).toEqual([
      ["http://api.test/v1/locations/loc/geocode", "POST"],
      ["http://api.test/v1/locations/loc/coordinates", "PUT"],
    ]);
  });

  it("maps every answer the API gives", async () => {
    for (const [status, body, expected] of [
      [401, { code: "x" }, "signed_out"],
      [403, { code: "x" }, "forbidden"],
      [404, { code: "x" }, "not_found"],
      [422, { code: "address_not_found" }, "address_not_found"],
      [400, { code: "validation_failed" }, "invalid"],
      [502, { code: "geocoding_failed" }, "lookup_failed"],
      [503, { code: "geocoding_not_configured" }, "not_configured"],
      [500, { code: "x" }, "unavailable"],
    ] as const) {
      expect((await geocodeLocation("s1", "loc", deps, respond(status, body))).status).toBe(
        expected,
      );
    }
    expect((await geocodeLocation(undefined, "loc", deps, respond(200, {}))).status).toBe(
      "signed_out",
    );
  });
});

describe("parseCoordinate", () => {
  it("accepts plain decimals within the limit and nothing else", () => {
    expect(parseCoordinate("32.7767", 90)).toBe(32.7767);
    expect(parseCoordinate(" -96.797 ", 180)).toBe(-96.797);
    expect(parseCoordinate("91", 90)).toBeUndefined();
    expect(parseCoordinate("", 90)).toBeUndefined();
    expect(parseCoordinate("32,7", 90)).toBeUndefined();
    expect(parseCoordinate("1e2", 180)).toBeUndefined();
    expect(parseCoordinate("N 32.7", 90)).toBeUndefined();
  });
});
