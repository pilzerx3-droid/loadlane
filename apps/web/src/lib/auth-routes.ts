import { clearCookie, cookieNames, readCookie, serializeCookie } from "./cookies";
import type { WebConfig } from "./config";
import type { OidcFlow } from "./oidc-flow";
import type { SessionData, SessionStore } from "./session-store";

export interface AuthDeps {
  config: WebConfig;
  store: SessionStore;
  oidc: OidcFlow;
  log: (message: string, error?: unknown) => void;
}

/** The login attempt (state, nonce, PKCE verifier) must be completed within this time. */
const LOGIN_TTL_SECONDS = 600;
/** Refresh the access token when it expires within this many seconds. */
const REFRESH_MARGIN_SECONDS = 30;

export type HomeError = "login_expired" | "access_denied" | "login_failed" | "provider_unavailable";

function redirect(location: string, status: 302 | 303, cookies: string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status, headers });
}

function home(deps: AuthDeps, error?: HomeError, cookies: string[] = []): Response {
  const url = new URL("/", deps.config.appUrl);
  if (error) url.searchParams.set("error", error);
  return redirect(url.href, 302, cookies);
}

/** GET /login: sends the browser to the provider. */
export async function handleLogin(request: Request, deps: AuthDeps): Promise<Response> {
  const names = cookieNames(deps.config.secureCookies);
  try {
    const { authorizationUrl, pending } = await deps.oidc.start();
    const loginId = await deps.store.savePendingLogin(pending, LOGIN_TTL_SECONDS);
    const loginCookie = serializeCookie(names.login, loginId, {
      maxAgeSeconds: LOGIN_TTL_SECONDS,
      secure: deps.config.secureCookies,
    });
    // A session that is still around is dropped: signing in again always starts a clean session.
    const cookies = [loginCookie];
    const oldSession = readCookie(request.headers.get("cookie"), names.session);
    if (oldSession) await deps.store.destroySession(oldSession);
    return redirect(authorizationUrl.href, 302, cookies);
  } catch (error) {
    deps.log("Could not start the sign-in", error);
    return home(deps, "provider_unavailable");
  }
}

/** GET /auth/callback: finishes the sign-in and creates the session. */
export async function handleCallback(request: Request, deps: AuthDeps): Promise<Response> {
  const names = cookieNames(deps.config.secureCookies);
  const secure = deps.config.secureCookies;
  const clearLogin = clearCookie(names.login, secure);
  const query = new URL(request.url).search;

  const loginId = readCookie(request.headers.get("cookie"), names.login);
  // The login record is deleted when it is read, so a callback URL works only once.
  const pending = loginId ? await deps.store.takePendingLogin(loginId) : undefined;
  if (!pending) return home(deps, "login_expired", [clearLogin]);

  const returned = new URLSearchParams(query);
  if (returned.has("error")) {
    // The provider's error text is not shown to the user; only the code is logged.
    deps.log(`The provider returned the error "${returned.get("error") ?? ""}"`);
    return home(deps, "access_denied", [clearLogin]);
  }

  try {
    // The URL is rebuilt from our own configuration so that a proxy cannot change host or scheme.
    const callbackUrl = new URL(deps.config.callbackUrl.href);
    callbackUrl.search = query;
    const tokens = await deps.oidc.complete(callbackUrl, pending);

    const session: SessionData = {
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      subject: tokens.subject,
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      ...(tokens.idToken ? { idToken: tokens.idToken } : {}),
    };
    const sessionId = await deps.store.createSession(session, deps.config.sessionTtlSeconds);
    const sessionCookie = serializeCookie(names.session, sessionId, {
      maxAgeSeconds: deps.config.sessionTtlSeconds,
      secure,
    });
    return redirect(new URL("/", deps.config.appUrl).href, 302, [clearLogin, sessionCookie]);
  } catch (error) {
    deps.log("Could not complete the sign-in", error);
    return home(deps, "login_failed", [clearLogin]);
  }
}

/** POST /logout: ends the session here and at the provider. */
export async function handleLogout(request: Request, deps: AuthDeps): Promise<Response> {
  const names = cookieNames(deps.config.secureCookies);
  const clearSession = clearCookie(names.session, deps.config.secureCookies);

  // Only our own pages may sign a person out (protects against forged cross-site requests).
  if (request.headers.get("origin") !== deps.config.appUrl.origin) {
    return new Response("Forbidden", { status: 403 });
  }

  const sessionId = readCookie(request.headers.get("cookie"), names.session);
  const session = sessionId ? await deps.store.getSession(sessionId) : undefined;
  if (sessionId) await deps.store.destroySession(sessionId);

  let target = new URL("/", deps.config.appUrl).href;
  try {
    const providerLogout = await deps.oidc.logoutUrl(session?.idToken);
    if (providerLogout) target = providerLogout.href;
  } catch (error) {
    deps.log("Could not build the provider's logout URL", error);
  }
  return redirect(target, 303, [clearSession]);
}

/**
 * Returns the session for a page request and renews the access token shortly before it expires.
 * Returns undefined (and deletes the session) when it cannot be used any more.
 */
export async function loadSession(
  sessionId: string | undefined,
  deps: AuthDeps,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<SessionData | undefined> {
  if (!sessionId) return undefined;
  const session = await deps.store.getSession(sessionId);
  if (!session) return undefined;
  if (session.accessTokenExpiresAt - nowSeconds > REFRESH_MARGIN_SECONDS) return session;

  if (!session.refreshToken) {
    await deps.store.destroySession(sessionId);
    return undefined;
  }
  try {
    const refreshed = await deps.oidc.refresh(session.refreshToken);
    const updated: SessionData = {
      accessToken: refreshed.accessToken,
      accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
      subject: session.subject,
      ...(session.activeOrganizationId
        ? { activeOrganizationId: session.activeOrganizationId }
        : {}),
      ...(refreshed.refreshToken ? { refreshToken: refreshed.refreshToken } : {}),
      ...((refreshed.idToken ?? session.idToken)
        ? { idToken: refreshed.idToken ?? session.idToken }
        : {}),
    };
    await deps.store.updateSession(sessionId, updated);
    return updated;
  } catch (error) {
    // Two parallel requests may race to refresh a rotating refresh token. If another request has
    // already stored fresh tokens, use them.
    const latest = await deps.store.getSession(sessionId);
    if (latest && latest.accessTokenExpiresAt - nowSeconds > REFRESH_MARGIN_SECONDS) return latest;
    deps.log("Could not refresh the session", error);
    await deps.store.destroySession(sessionId);
    return undefined;
  }
}
