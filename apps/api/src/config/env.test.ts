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
      maxOrganizationsPerUser: 3,
      tracesExporter: "none",
      appUrl: "http://localhost:3000",
    });
  });

  it("reads the mail settings and needs a sender with a server", () => {
    const config = loadApiConfig({
      ...valid,
      APP_URL: "https://app.example.com/",
      MAIL_SMTP_URL: "smtp://127.0.0.1:1025",
      MAIL_FROM: "Loadlane <no-reply@example.com>",
    });
    expect(config.appUrl).toBe("https://app.example.com");
    expect(config.mail).toEqual({
      smtpUrl: "smtp://127.0.0.1:1025",
      from: "Loadlane <no-reply@example.com>",
    });
    expect(() => loadApiConfig({ ...valid, MAIL_SMTP_URL: "smtp://127.0.0.1:1025" })).toThrow(
      /MAIL_FROM/,
    );
    expect(() =>
      loadApiConfig({ ...valid, MAIL_SMTP_URL: "http://x", MAIL_FROM: "a@b.co" }),
    ).toThrow(/MAIL_SMTP_URL/);
  });

  it("reads the trace exporter and rejects an unknown one", () => {
    expect(loadApiConfig({ ...valid, OTEL_TRACES_EXPORTER: "otlp" }).tracesExporter).toBe("otlp");
    expect(() => loadApiConfig({ ...valid, OTEL_TRACES_EXPORTER: "zipkin" })).toThrow(
      /OTEL_TRACES_EXPORTER/,
    );
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
