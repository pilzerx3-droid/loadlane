import { describe, expect, it } from "vitest";
import { handleCallback, handleLogin, handleLogout, loadSession } from "./auth-routes";
import { cookieNames } from "./cookies";
import {
  makeDeps,
  PENDING,
  request,
  setCookies,
  testConfig,
  type TestDeps,
} from "../testing/helpers";

const APP = "http://localhost:3000";
const names = cookieNames(false);

/** Starts a login and returns the cookie header a browser would send to the callback. */
async function startLogin(deps: TestDeps): Promise<string> {
  const response = await handleLogin(request(`${APP}/login`), deps);
  const loginCookie = setCookies(response).find((c) => c.startsWith(`${names.login}=`)) ?? "";
  return loginCookie.split(";")[0] ?? "";
}

describe("GET /login", () => {
  it("redirects to the provider and remembers the attempt in a short-lived cookie", async () => {
    const deps = makeDeps();
    const response = await handleLogin(request(`${APP}/login`), deps);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://idp.example.com/authorize?state=state-1",
    );
    const [cookie] = setCookies(response);
    expect(cookie).toMatch(/^ll_login=login-\d+; Path=\/; Max-Age=600; HttpOnly; SameSite=Lax$/);
    expect([...deps.store.pending.values()]).toEqual([PENDING]);
  });

  it("uses the __Host- prefix and Secure over https", async () => {
    const deps = makeDeps({ config: testConfig({ APP_URL: "https://app.example.com" }) });
    const response = await handleLogin(request("https://app.example.com/login"), deps);
    expect(setCookies(response)[0]).toMatch(/^__Host-ll_login=.*; Secure$/);
  });

  it("drops a session that is still around", async () => {
    const deps = makeDeps();
    const id = await deps.store.createSession(
      { accessToken: "a", accessTokenExpiresAt: 1, subject: "s" },
      60,
    );
    await handleLogin(request(`${APP}/login`, { cookie: `${names.session}=${id}` }), deps);
    expect(deps.store.sessions.size).toBe(0);
  });

  it("sends the browser home with an error when the provider cannot be reached", async () => {
    const deps = makeDeps({ oidc: { start: () => Promise.reject(new Error("down")) } });
    const response = await handleLogin(request(`${APP}/login`), deps);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${APP}/?error=provider_unavailable`);
    expect(deps.log).toHaveBeenCalled();
  });
});

describe("GET /auth/callback", () => {
  it("creates a session, clears the login cookie and goes home", async () => {
    const deps = makeDeps();
    const cookie = await startLogin(deps);

    const response = await handleCallback(
      request(`${APP}/auth/callback?code=c1&state=state-1`, { cookie }),
      deps,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${APP}/`);
    const cookies = setCookies(response);
    expect(cookies.find((c) => c.startsWith("ll_login="))).toContain("Max-Age=0");
    expect(cookies.find((c) => c.startsWith("ll_session="))).toMatch(
      /^ll_session=session-\d+; Path=\/; Max-Age=28800; HttpOnly; SameSite=Lax$/,
    );
    expect([...deps.store.sessions.values()]).toEqual([
      {
        accessToken: "access-1",
        accessTokenExpiresAt: expect.any(Number) as number,
        refreshToken: "refresh-1",
        idToken: "id-1",
        subject: "subject-1",
      },
    ]);
    expect(deps.store.ttls).toEqual([28_800]);
  });

  it("verifies against the stored attempt, with the callback URL built from our own configuration", async () => {
    const deps = makeDeps();
    const cookie = await startLogin(deps);

    await handleCallback(
      request(`http://evil.example:9999/auth/callback?code=c1&state=state-1`, { cookie }),
      deps,
    );

    expect(deps.oidc.complete).toHaveBeenCalledTimes(1);
    const [url, pending] = deps.oidc.complete.mock.calls[0] ?? [];
    expect(url?.href).toBe(`${APP}/auth/callback?code=c1&state=state-1`);
    expect(pending).toEqual(PENDING);
  });

  it("can be used only once", async () => {
    const deps = makeDeps();
    const cookie = await startLogin(deps);
    const callback = () => request(`${APP}/auth/callback?code=c1&state=state-1`, { cookie });

    expect((await handleCallback(callback(), deps)).headers.get("location")).toBe(`${APP}/`);
    const replay = await handleCallback(callback(), deps);
    expect(replay.headers.get("location")).toBe(`${APP}/?error=login_expired`);
    expect(deps.store.sessions.size).toBe(1);
  });

  it.each([
    ["without a login cookie", undefined],
    ["with an unknown login cookie", "ll_login=login-999"],
  ])("rejects a callback %s", async (_name, cookie) => {
    const deps = makeDeps();
    const response = await handleCallback(
      request(`${APP}/auth/callback?code=c1&state=state-1`, cookie ? { cookie } : {}),
      deps,
    );
    expect(response.headers.get("location")).toBe(`${APP}/?error=login_expired`);
    expect(deps.oidc.complete).not.toHaveBeenCalled();
    expect(deps.store.sessions.size).toBe(0);
  });

  it("does not show the provider's error text", async () => {
    const deps = makeDeps();
    const cookie = await startLogin(deps);
    const response = await handleCallback(
      request(`${APP}/auth/callback?error=access_denied&error_description=secret+details`, {
        cookie,
      }),
      deps,
    );
    expect(response.headers.get("location")).toBe(`${APP}/?error=access_denied`);
    expect(response.headers.get("location")).not.toContain("secret");
    expect(deps.oidc.complete).not.toHaveBeenCalled();
  });

  it("creates no session when the token exchange fails", async () => {
    const deps = makeDeps({ oidc: { complete: () => Promise.reject(new Error("bad state")) } });
    const cookie = await startLogin(deps);
    const response = await handleCallback(
      request(`${APP}/auth/callback?code=c1&state=forged`, { cookie }),
      deps,
    );
    expect(response.headers.get("location")).toBe(`${APP}/?error=login_failed`);
    expect(setCookies(response).some((c) => c.startsWith("ll_session="))).toBe(false);
    expect(deps.store.sessions.size).toBe(0);
  });
});

describe("POST /logout", () => {
  async function signedInDeps(overrides: Parameters<typeof makeDeps>[0] = {}) {
    const deps = makeDeps(overrides);
    const id = await deps.store.createSession(
      { accessToken: "a", accessTokenExpiresAt: 1, subject: "s", idToken: "id-token" },
      60,
    );
    return { deps, cookie: `${names.session}=${id}` };
  }

  it("ends the session and sends the browser to the provider's logout", async () => {
    const { deps, cookie } = await signedInDeps();
    const response = await handleLogout(
      request(`${APP}/logout`, { method: "POST", cookie, origin: APP }),
      deps,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://idp.example.com/logout?x=1");
    expect(setCookies(response)[0]).toContain("Max-Age=0");
    expect(deps.store.sessions.size).toBe(0);
    expect(deps.oidc.logoutUrl).toHaveBeenCalledWith("id-token");
  });

  it("goes home when the provider has no end-session endpoint", async () => {
    const { deps, cookie } = await signedInDeps({
      oidc: { logoutUrl: () => Promise.resolve(undefined) },
    });
    const response = await handleLogout(
      request(`${APP}/logout`, { method: "POST", cookie, origin: APP }),
      deps,
    );
    expect(response.headers.get("location")).toBe(`${APP}/`);
    expect(deps.store.sessions.size).toBe(0);
  });

  it("still signs out locally when the provider's logout URL cannot be built", async () => {
    const { deps, cookie } = await signedInDeps({
      oidc: { logoutUrl: () => Promise.reject(new Error("x")) },
    });
    const response = await handleLogout(
      request(`${APP}/logout`, { method: "POST", cookie, origin: APP }),
      deps,
    );
    expect(response.headers.get("location")).toBe(`${APP}/`);
    expect(deps.store.sessions.size).toBe(0);
  });

  it.each([
    ["another origin", "https://evil.example"],
    ["no origin", undefined],
  ])("refuses a request with %s and keeps the session", async (_name, origin) => {
    const { deps, cookie } = await signedInDeps();
    const response = await handleLogout(
      request(`${APP}/logout`, { method: "POST", cookie, ...(origin ? { origin } : {}) }),
      deps,
    );
    expect(response.status).toBe(403);
    expect(deps.store.sessions.size).toBe(1);
  });
});

describe("loadSession", () => {
  const NOW = 1_800_000_000;
  const fresh = {
    accessToken: "a",
    accessTokenExpiresAt: NOW + 300,
    subject: "s",
    refreshToken: "r",
  };
  const expiring = { ...fresh, accessTokenExpiresAt: NOW + 10 };

  it("returns nothing without a cookie or for an unknown session", async () => {
    const deps = makeDeps();
    expect(await loadSession(undefined, deps, NOW)).toBeUndefined();
    expect(await loadSession("nope", deps, NOW)).toBeUndefined();
  });

  it("returns a session that is still valid without calling the provider", async () => {
    const deps = makeDeps();
    const id = await deps.store.createSession(fresh, 60);
    expect(await loadSession(id, deps, NOW)).toEqual(fresh);
    expect(deps.oidc.refresh).not.toHaveBeenCalled();
  });

  it("renews an access token that is about to expire and keeps the identity", async () => {
    const deps = makeDeps();
    const id = await deps.store.createSession({ ...expiring, idToken: "id-old" }, 60);

    const session = await loadSession(id, deps, NOW);

    expect(deps.oidc.refresh).toHaveBeenCalledWith("r");
    expect(session).toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      subject: "s",
      idToken: "id-old",
    });
    expect(deps.store.sessions.get(id)).toEqual(session);
  });

  it("ends a session that cannot be renewed because there is no refresh token", async () => {
    const deps = makeDeps();
    const id = await deps.store.createSession(
      { accessToken: "a", accessTokenExpiresAt: expiring.accessTokenExpiresAt, subject: "s" },
      60,
    );
    expect(await loadSession(id, deps, NOW)).toBeUndefined();
    expect(deps.store.sessions.size).toBe(0);
  });

  it("ends a session when the provider refuses the refresh token", async () => {
    const deps = makeDeps({ oidc: { refresh: () => Promise.reject(new Error("invalid_grant")) } });
    const id = await deps.store.createSession(expiring, 60);
    expect(await loadSession(id, deps, NOW)).toBeUndefined();
    expect(deps.store.sessions.size).toBe(0);
  });

  it("uses tokens that a parallel request stored while this refresh failed", async () => {
    const deps = makeDeps();
    const id = await deps.store.createSession(expiring, 60);
    deps.oidc.refresh.mockImplementationOnce(() => {
      deps.store.sessions.set(id, { ...fresh, accessToken: "from-parallel-request" });
      return Promise.reject(new Error("refresh token already used"));
    });
    expect((await loadSession(id, deps, NOW))?.accessToken).toBe("from-parallel-request");
    expect(deps.store.sessions.size).toBe(1);
  });
});
