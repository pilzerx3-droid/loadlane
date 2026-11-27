import { describe, expect, it, vi } from "vitest";
import { fetchMe } from "./api-client";
import { loadHome } from "./home";
import { makeDeps } from "../testing/helpers";

const me = {
  user: { id: "u1", email: "ada@example.com", displayName: "Ada" },
  organizations: [{ id: "o1", name: "Acme", slug: "acme", region: "us" }],
};

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

async function sessionFor(deps: ReturnType<typeof makeDeps>): Promise<string> {
  return deps.store.createSession(
    {
      accessToken: "access-1",
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
      subject: "s",
    },
    60,
  );
}

describe("fetchMe", () => {
  it("sends the access token and returns the parsed answer", async () => {
    const fetchFn = respond(200, me);
    expect(await fetchMe("http://api", "tok", fetchFn)).toEqual({ status: "ok", me });
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe("http://api/v1/me");
    expect((init?.headers as Record<string, string>)["authorization"]).toBe("Bearer tok");
  });

  it.each([
    [401, {}, "unauthorized"],
    [403, { code: "email_not_verified" }, "email_not_verified"],
    [403, { code: "account_disabled" }, "account_disabled"],
    [403, { something: "else" }, "account_disabled"],
    [409, { code: "email_in_use" }, "email_in_use"],
    [503, {}, "unavailable"],
    [500, {}, "unavailable"],
  ])("maps HTTP %i %j to %s", async (status, body, expected) => {
    expect((await fetchMe("http://api", "tok", respond(status, body))).status).toBe(expected);
  });

  it("treats an answer of the wrong shape as unavailable", async () => {
    expect((await fetchMe("http://api", "t", respond(200, { user: {} }))).status).toBe(
      "unavailable",
    );
  });

  it("treats a network failure as unavailable", async () => {
    const failing = vi.fn(() =>
      Promise.reject(new TypeError("fetch failed")),
    ) as unknown as typeof fetch;
    expect((await fetchMe("http://api", "t", failing)).status).toBe("unavailable");
  });
});

describe("loadHome", () => {
  it("is signed out without a session", async () => {
    expect(await loadHome(undefined, makeDeps(), respond(200, me))).toEqual({ kind: "signed_out" });
  });

  it("shows the person and their organizations", async () => {
    const deps = makeDeps();
    const state = await loadHome(await sessionFor(deps), deps, respond(200, me));
    expect(state).toEqual({ kind: "signed_in", me });
  });

  it("signs out and forgets the session when the API rejects the token", async () => {
    const deps = makeDeps();
    const state = await loadHome(await sessionFor(deps), deps, respond(401, {}));
    expect(state).toEqual({ kind: "signed_out" });
    expect(deps.store.sessions.size).toBe(0);
  });

  it("reports a problem but keeps the session when the API is unavailable", async () => {
    const deps = makeDeps();
    const state = await loadHome(await sessionFor(deps), deps, respond(503, {}));
    expect(state).toEqual({ kind: "problem", problem: "unavailable" });
    expect(deps.store.sessions.size).toBe(1);
  });

  it("explains an unverified e-mail address", async () => {
    const deps = makeDeps();
    const state = await loadHome(
      await sessionFor(deps),
      deps,
      respond(403, { code: "email_not_verified" }),
    );
    expect(state).toEqual({ kind: "problem", problem: "email_not_verified" });
  });
});
