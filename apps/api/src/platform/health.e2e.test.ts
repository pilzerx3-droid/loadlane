// Health checks and security headers of the API (production readiness, phase 8).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers.ts";
import { startTestApi, type TestApi } from "../testing/harness.ts";

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
});

describe("health checks", () => {
  it("answers liveness and readiness without signing in and without revealing anything", async () => {
    for (const path of ["/v1/health", "/v1/health/ready"]) {
      const response = await fetch(`${api.baseUrl}${path}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok" });
    }
  });
});

describe("security headers", () => {
  it("are set on every response, including errors and unknown routes", async () => {
    for (const path of ["/v1/health", "/v1/me", "/v1/does-not-exist"]) {
      const response = await fetch(`${api.baseUrl}${path}`);
      expect(response.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(response.headers.get("x-frame-options"), path).toBe("DENY");
      expect(response.headers.get("referrer-policy"), path).toBe("no-referrer");
      expect(response.headers.get("content-security-policy"), path).toContain("default-src 'none'");
      expect(response.headers.get("cache-control"), path).toBe("no-store");
      expect(response.headers.get("x-powered-by"), path).toBeNull();
    }
  });

  it("asks browsers to keep using HTTPS only when the request came over HTTPS", async () => {
    const plain = await fetch(`${api.baseUrl}/v1/health`);
    expect(plain.headers.get("strict-transport-security")).toBeNull();
    const proxied = await fetch(`${api.baseUrl}/v1/health`, {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(proxied.headers.get("strict-transport-security")).toContain("max-age=31536000");
  });

  it("is a plain middleware that calls next", () => {
    const headers: Record<string, string> = {};
    let called = false;
    securityHeaders()(
      { headers: {}, secure: true } as never,
      { setHeader: (name: string, value: string) => (headers[name] = value) } as never,
      () => (called = true),
    );
    expect(called).toBe(true);
    expect(headers["Strict-Transport-Security"]).toBeDefined();
  });
});
