import { describe, expect, it } from "vitest";
import { buildCsp, newNonce } from "./csp";

describe("buildCsp", () => {
  it("allows scripts only with the nonce and forbids framing, plugins and foreign targets", () => {
    const csp = buildCsp("abc123", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toMatch(/https?:\/\//);
  });

  it("opens tile hosts only when asked and adds the map worker", () => {
    const csp = buildCsp("n", false, ["https://tiles.openfreemap.org"]);
    expect(csp).toContain("connect-src 'self' https://tiles.openfreemap.org");
    expect(csp).toContain("img-src 'self' data: blob: https://tiles.openfreemap.org");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("script-src 'self' 'nonce-n' 'strict-dynamic'");
    expect(buildCsp("n", false)).not.toContain("worker-src");
  });

  it("adds unsafe-eval only in development", () => {
    expect(buildCsp("n", true)).toContain("'unsafe-eval'");
    expect(buildCsp("n", false)).not.toContain("'unsafe-eval'");
  });
});

describe("newNonce", () => {
  it("is different every time and safe in a header", () => {
    const first = newNonce();
    expect(first).not.toBe(newNonce());
    expect(first).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});
