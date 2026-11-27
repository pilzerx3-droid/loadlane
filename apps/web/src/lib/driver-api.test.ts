import { describe, expect, it } from "vitest";
import { z } from "zod";
import { driverRequest } from "./driver-api";

function respond(status: number, body: unknown): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
}

const call = (fetchFn: typeof fetch, json?: unknown) =>
  driverRequest({
    apiUrl: "http://api.test",
    token: "tok",
    path: "position",
    schema: z.object({ accepted: z.literal(true) }),
    ...(json === undefined ? {} : { json }),
    fetchFn,
  });

describe("driverRequest", () => {
  it("returns parsed data on success", async () => {
    expect(await call(respond(201, { accepted: true }), {})).toEqual({
      ok: true,
      data: { accepted: true },
    });
  });

  it("treats an unexpected body as unavailable instead of trusting it", async () => {
    expect(await call(respond(200, { accepted: false }))).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it.each([
    [404, { code: "driver_link_invalid" }, "invalid"],
    [410, { code: "driver_link_revoked" }, "revoked"],
    [410, { code: "driver_link_expired" }, "expired"],
    [403, { code: "consent_required" }, "consent_required"],
    [403, { code: "other" }, "unavailable"],
    [409, { code: "tracking_closed" }, "tracking_closed"],
    [409, { code: "invalid_transition" }, "conflict"],
    [400, { code: "validation_failed" }, "rejected"],
    [500, {}, "unavailable"],
  ])("maps HTTP %i %o to %s", async (status, problem, reason) => {
    expect(await call(respond(status, problem))).toEqual({ ok: false, reason });
  });

  it("sends the token in a header and never in the address", async () => {
    let seen: { url: string; headers: Headers } | undefined;
    const spy: typeof fetch = (input, init) => {
      seen = { url: typeof input === "string" ? input : "", headers: new Headers(init?.headers) };
      return Promise.resolve(new Response(JSON.stringify({ accepted: true }), { status: 201 }));
    };
    await call(spy, {});
    expect(seen?.headers.get("x-driver-token")).toBe("tok");
    expect(seen?.url).toBe("http://api.test/v1/driver/position");
    expect(seen?.url).not.toContain("tok");
  });

  it("reports a network failure as unavailable", async () => {
    const down: typeof fetch = () => Promise.reject(new Error("offline"));
    expect(await call(down)).toEqual({ ok: false, reason: "unavailable" });
  });
});
