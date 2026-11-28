import { describe, expect, it } from "vitest";
import { carrierRequest, spotUrl } from "./spot";

function respond(status: number, body: unknown): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
}

const offer = {
  state: "open",
  transportReference: "LL-000001",
  responseDeadline: "2030-12-01T20:00:00.000Z",
  weightLb: null,
  pieces: null,
  stops: [],
  yourBid: null,
};

describe("carrierRequest", () => {
  const call = (fetchFn: typeof fetch) =>
    carrierRequest({ apiUrl: "http://api.test", token: "tok", path: "bid", json: {}, fetchFn });

  it("parses the offer and sends the token in a header only", async () => {
    let seen: { url: string; token: string | null } | undefined;
    const spy: typeof fetch = (input, init) => {
      seen = {
        url: typeof input === "string" ? input : "",
        token: new Headers(init?.headers).get("x-spot-token"),
      };
      return Promise.resolve(new Response(JSON.stringify(offer), { status: 200 }));
    };
    expect((await call(spy)).ok).toBe(true);
    expect(seen).toEqual({ url: "http://api.test/v1/spot/bid", token: "tok" });
  });

  it.each([
    [404, {}, "invalid"],
    [410, {}, "gone"],
    [409, { code: "deadline_passed" }, "deadline_passed"],
    [409, { code: "spot_closed" }, "closed"],
    [400, {}, "rejected"],
    [500, {}, "unavailable"],
  ])("maps HTTP %i %o to %s", async (status, problem, reason) => {
    expect(await call(respond(status, problem))).toEqual({ ok: false, reason });
  });

  it("does not trust an unexpected body or a dead network", async () => {
    expect(await call(respond(200, { nope: 1 }))).toEqual({ ok: false, reason: "unavailable" });
    expect(await call(() => Promise.reject(new Error("offline")))).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("builds the carrier address", () => {
    expect(spotUrl("https://app.example.com", "a-b_c")).toBe("https://app.example.com/s/a-b_c");
  });
});
