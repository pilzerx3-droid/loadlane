// Test doubles for the sign-in logic. They replace the provider (OidcFlow) and the session storage,
// so these tests prove OUR logic. The protocol itself is the job of openid-client and is checked
// against a real provider in a manual end-to-end run.
import { vi, type Mock } from "vitest";
import type { AuthDeps } from "../lib/auth-routes";
import { loadWebConfig, type WebConfig } from "../lib/config";
import type { OidcFlow } from "../lib/oidc-flow";
import type { PendingLogin, SessionData, SessionStore } from "../lib/session-store";

export class MemoryStore implements SessionStore {
  readonly sessions = new Map<string, SessionData>();
  readonly pending = new Map<string, PendingLogin>();
  readonly ttls: number[] = [];
  private counter = 0;

  createSession(data: SessionData, ttlSeconds: number): Promise<string> {
    const id = `session-${++this.counter}`;
    this.sessions.set(id, data);
    this.ttls.push(ttlSeconds);
    return Promise.resolve(id);
  }
  getSession(id: string): Promise<SessionData | undefined> {
    return Promise.resolve(this.sessions.get(id));
  }
  updateSession(id: string, data: SessionData): Promise<void> {
    if (this.sessions.has(id)) this.sessions.set(id, data);
    return Promise.resolve();
  }
  destroySession(id: string): Promise<void> {
    this.sessions.delete(id);
    return Promise.resolve();
  }
  savePendingLogin(pending: PendingLogin): Promise<string> {
    const id = `login-${++this.counter}`;
    this.pending.set(id, pending);
    return Promise.resolve(id);
  }
  takePendingLogin(id: string): Promise<PendingLogin | undefined> {
    const value = this.pending.get(id);
    this.pending.delete(id);
    return Promise.resolve(value);
  }
}

export function testConfig(overrides: Record<string, string> = {}): WebConfig {
  return loadWebConfig({
    OIDC_ISSUER: "https://idp.example.com",
    OIDC_CLIENT_ID: "client-1",
    APP_URL: "http://localhost:3000",
    API_URL: "http://127.0.0.1:4000",
    REDIS_URL: "redis://127.0.0.1:6379",
    ...overrides,
  });
}

export const PENDING: PendingLogin = {
  state: "state-1",
  nonce: "nonce-1",
  codeVerifier: "verifier-1",
};

export type StubOidc = { [K in keyof OidcFlow]: Mock<OidcFlow[K]> };

export function stubOidc(overrides: Partial<OidcFlow> = {}): StubOidc {
  return {
    start: vi.fn<OidcFlow["start"]>(() =>
      Promise.resolve({
        authorizationUrl: new URL("https://idp.example.com/authorize?state=state-1"),
        pending: PENDING,
      }),
    ),
    complete: vi.fn<OidcFlow["complete"]>(() =>
      Promise.resolve({
        accessToken: "access-1",
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
        refreshToken: "refresh-1",
        idToken: "id-1",
        subject: "subject-1",
      }),
    ),
    refresh: vi.fn<OidcFlow["refresh"]>(() =>
      Promise.resolve({
        accessToken: "access-2",
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
        refreshToken: "refresh-2",
      }),
    ),
    logoutUrl: vi.fn<OidcFlow["logoutUrl"]>(() =>
      Promise.resolve(new URL("https://idp.example.com/logout?x=1")),
    ),
    ...overrides,
  } as StubOidc;
}

export interface TestDeps extends AuthDeps {
  store: MemoryStore;
  oidc: StubOidc;
  log: Mock<AuthDeps["log"]>;
}

export function makeDeps(options: { config?: WebConfig; oidc?: Partial<OidcFlow> } = {}): TestDeps {
  return {
    config: options.config ?? testConfig(),
    store: new MemoryStore(),
    oidc: stubOidc(options.oidc),
    log: vi.fn<AuthDeps["log"]>(),
  };
}

export function request(
  url: string,
  options: { method?: string; cookie?: string; origin?: string } = {},
): Request {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.origin) headers.set("origin", options.origin);
  return new Request(url, { method: options.method ?? "GET", headers });
}

/** All Set-Cookie headers of a response, as strings. */
export function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}
