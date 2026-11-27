import { describe, expect, it } from "vitest";
import { loadWebConfig } from "./config";

const valid = {
  OIDC_ISSUER: "https://example.zitadel.cloud",
  OIDC_CLIENT_ID: "client-1",
  APP_URL: "http://localhost:3000",
  API_URL: "http://127.0.0.1:4000/",
  REDIS_URL: "redis://127.0.0.1:6379",
};

describe("loadWebConfig", () => {
  it("derives callback and post-logout URLs from APP_URL and trims the API URL", () => {
    const config = loadWebConfig(valid);
    expect(config.callbackUrl.href).toBe("http://localhost:3000/auth/callback");
    expect(config.postLogoutUrl.href).toBe("http://localhost:3000/");
    expect(config.apiUrl).toBe("http://127.0.0.1:4000");
    expect(config.sessionTtlSeconds).toBe(28_800);
    expect(config.secureCookies).toBe(false);
  });

  it("uses secure cookies when the app is served over https", () => {
    expect(loadWebConfig({ ...valid, APP_URL: "https://app.example.com" }).secureCookies).toBe(
      true,
    );
  });

  it.each(["not-a-url", "", "https//missing-colon.example.com", "ftp://idp.example.com"])(
    "reports an unusable issuer %j as a configuration problem, not as a crash",
    (issuer) => {
      expect(() => loadWebConfig({ ...valid, OIDC_ISSUER: issuer })).toThrow(
        /Invalid web configuration[\s\S]*OIDC_ISSUER/,
      );
    },
  );

  it("allows an http issuer for localhost only", () => {
    expect(() => loadWebConfig({ ...valid, OIDC_ISSUER: "http://localhost:8080" })).not.toThrow();
    expect(() => loadWebConfig({ ...valid, OIDC_ISSUER: "http://idp.example.com" })).toThrow(
      /https/,
    );
  });

  it("limits the session lifetime to a sane range", () => {
    expect(() => loadWebConfig({ ...valid, SESSION_TTL_SECONDS: "5" })).toThrow(
      /SESSION_TTL_SECONDS/,
    );
    expect(loadWebConfig({ ...valid, SESSION_TTL_SECONDS: "3600" }).sessionTtlSeconds).toBe(3600);
  });

  it("lists every missing variable at once", () => {
    expect(() => loadWebConfig({})).toThrow(
      /OIDC_ISSUER[\s\S]*OIDC_CLIENT_ID[\s\S]*APP_URL[\s\S]*API_URL[\s\S]*REDIS_URL/,
    );
  });
});
