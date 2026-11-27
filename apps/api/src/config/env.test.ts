import { describe, expect, it } from "vitest";
import { loadApiConfig } from "./env.ts";

const valid = {
  APP_DATABASE_URL: "postgres://loadlane_app:secret@127.0.0.1:5432/loadlane",
  OIDC_ISSUER: "https://example.zitadel.cloud",
  OIDC_AUDIENCE: "project-1",
};

describe("loadApiConfig", () => {
  it("applies the defaults", () => {
    expect(loadApiConfig(valid)).toEqual({
      host: "127.0.0.1",
      port: 4000,
      databaseUrl: valid.APP_DATABASE_URL,
      oidcIssuer: valid.OIDC_ISSUER,
      oidcAudience: "project-1",
      logLevel: "info",
      rateLimitPerMinute: 120,
      openApiEnabled: true,
    });
  });

  it("does not serve the OpenAPI document in production unless asked to", () => {
    expect(loadApiConfig({ ...valid, NODE_ENV: "production" }).openApiEnabled).toBe(false);
    expect(
      loadApiConfig({ ...valid, NODE_ENV: "production", OPENAPI_ENABLED: "true" }).openApiEnabled,
    ).toBe(true);
    expect(loadApiConfig({ ...valid, OPENAPI_ENABLED: "false" }).openApiEnabled).toBe(false);
  });

  it("reads log level and rate limit and rejects nonsense", () => {
    expect(
      loadApiConfig({ ...valid, LOG_LEVEL: "debug", RATE_LIMIT_PER_MINUTE: "30" }),
    ).toMatchObject({ logLevel: "debug", rateLimitPerMinute: 30 });
    expect(() => loadApiConfig({ ...valid, LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
    expect(() => loadApiConfig({ ...valid, RATE_LIMIT_PER_MINUTE: "0" })).toThrow(
      /RATE_LIMIT_PER_MINUTE/,
    );
  });

  it("reads host and port", () => {
    expect(loadApiConfig({ ...valid, API_HOST: "0.0.0.0", API_PORT: "8080" })).toMatchObject({
      host: "0.0.0.0",
      port: 8080,
    });
  });

  it.each(["not-a-url", "", "https//missing-colon.example.com", "ftp://idp.example.com"])(
    "reports an unusable issuer %j as a configuration problem, not as a crash",
    (issuer) => {
      expect(() => loadApiConfig({ ...valid, OIDC_ISSUER: issuer })).toThrow(
        /Invalid API configuration[\s\S]*OIDC_ISSUER/,
      );
    },
  );

  it("allows an http issuer for localhost only", () => {
    expect(() => loadApiConfig({ ...valid, OIDC_ISSUER: "http://127.0.0.1:9000" })).not.toThrow();
    expect(() => loadApiConfig({ ...valid, OIDC_ISSUER: "http://idp.example.com" })).toThrow(
      /https/,
    );
  });

  it("lists every missing or invalid variable at once", () => {
    expect(() => loadApiConfig({ API_PORT: "70000" })).toThrow(
      /API_PORT[\s\S]*APP_DATABASE_URL[\s\S]*OIDC_ISSUER[\s\S]*OIDC_AUDIENCE/,
    );
  });
});
