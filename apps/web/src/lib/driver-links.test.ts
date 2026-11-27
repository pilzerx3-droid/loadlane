import { describe, expect, it, vi } from "vitest";
import type { AuthDeps } from "./auth-routes";
import { createDriverLink, driverLinkUrl, revokeDriverLink } from "./driver-links";

vi.mock("./auth-routes", () => ({
  loadSession: (sessionId: string | undefined) =>
    Promise.resolve(
      sessionId === "s1" ? { accessToken: "jwt", activeOrganizationId: "org-1" } : undefined,
    ),
}));

const deps = {
  config: { apiUrl: "http://api.test", appUrl: new URL("https://app.example.com") },
  log: () => undefined,
} as unknown as AuthDeps;

function respond(status: number, body: unknown): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
}

const created = {
  id: "11111111-1111-4111-8111-111111111111",
  transportId: "22222222-2222-4222-8222-222222222222",
  state: "active",
  expiresAt: "2030-12-03T22:00:00.000Z",
  createdAt: "2030-11-30T10:00:00.000Z",
  revokedAt: null,
  createdBy: { id: "u", displayName: "Dana" },
  consent: null,
  token: "secret-token_123",
};

describe("driver links", () => {
  it("builds the driver address from the app origin and the token", () => {
    expect(driverLinkUrl("https://app.example.com", "a-b_c")).toBe(
      "https://app.example.com/d/a-b_c",
    );
    expect(driverLinkUrl("https://app.example.com", "a/b")).toBe("https://app.example.com/d/a%2Fb");
  });

  it("returns the full link once on creation", async () => {
    const result = await createDriverLink("s1", "t", deps, respond(201, created));
    expect(result).toEqual({
      status: "created",
      url: "https://app.example.com/d/secret-token_123",
      expiresAt: "2030-12-03T22:00:00.000Z",
    });
  });

  it.each([
    [401, "signed_out"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "closed"],
    [500, "unavailable"],
  ])("maps API status %i to %s", async (status, expected) => {
    const result = await createDriverLink("s1", "t", deps, respond(status, { code: "x" }));
    expect(result.status).toBe(expected);
  });

  it("is signed out without a session", async () => {
    expect((await createDriverLink(undefined, "t", deps, respond(201, created))).status).toBe(
      "signed_out",
    );
    expect(await revokeDriverLink(undefined, "l", deps, respond(200, created))).toBe("signed_out");
  });

  it("revokes and maps failures", async () => {
    expect(await revokeDriverLink("s1", "l", deps, respond(200, created))).toBe("done");
    expect(await revokeDriverLink("s1", "l", deps, respond(404, { code: "x" }))).toBe("not_found");
    expect(await revokeDriverLink("s1", "l", deps, respond(403, { code: "x" }))).toBe("forbidden");
  });
});
