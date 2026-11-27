import { describe, expect, it } from "vitest";
import { loadApiConfig } from "./env.ts";

const valid = {
  APP_DATABASE_URL: "postgres://loadlane_app:secret@127.0.0.1:5432/loadlane",
  OIDC_ISSUER: "https://example.zitadel.cloud",
  OIDC_AUDIENCE: "project-1",
};

describe("loadApiConfig", () => {
  it("applies defaults for host and port", () => {
    expect(loadApiConfig(valid)).toEqual({
      host: "127.0.0.1",
      port: 4000,
      databaseUrl: valid.APP_DATABASE_URL,
      oidcIssuer: valid.OIDC_ISSUER,
      oidcAudience: "project-1",
    });
  });

  it("reads host and port", () => {
    expect(loadApiConfig({ ...valid, API_HOST: "0.0.0.0", API_PORT: "8080" })).toMatchObject({
      host: "0.0.0.0",
      port: 8080,
    });
  });

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
