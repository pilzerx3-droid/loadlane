import { describe, expect, it, vi } from "vitest";
import type { AuthDeps } from "./auth-routes";
import { createWebhook, disableWebhook } from "./webhooks";

vi.mock("./auth-routes", () => ({
  loadSession: (sessionId: string | undefined) =>
    Promise.resolve(
      sessionId === "s1" ? { accessToken: "jwt", activeOrganizationId: "org-1" } : undefined,
    ),
}));

const deps = { config: { apiUrl: "http://api.test" }, log: () => undefined } as unknown as AuthDeps;

function respond(status: number, body: unknown): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
}

const hook = {
  id: "h1",
  url: "https://example.com/in",
  events: ["transport.status_changed"],
  state: "active",
  createdAt: "2030-01-01T00:00:00Z",
  disabledAt: null,
  createdBy: { id: "u", displayName: "Dana" },
  pending: 0,
  failed: 0,
};

describe("webhooks", () => {
  it("returns the secret once on creation and maps failures", async () => {
    expect(
      await createWebhook(
        "s1",
        "https://example.com/in",
        deps,
        respond(201, { ...hook, secret: "whsec_abc" }),
      ),
    ).toEqual({ status: "created", secret: "whsec_abc" });
    for (const [status, body, expected] of [
      [401, { code: "x" }, "signed_out"],
      [403, { code: "x" }, "forbidden"],
      [400, { code: "validation_failed" }, "invalid"],
      [503, { code: "webhooks_not_configured" }, "not_configured"],
      [500, { code: "x" }, "unavailable"],
    ] as const) {
      const result = await createWebhook("s1", "https://x.example", deps, respond(status, body));
      expect(result.status).toBe(expected);
    }
    const signedOut = await createWebhook(undefined, "https://x.example", deps, respond(201, {}));
    expect(signedOut.status).toBe("signed_out");
  });

  it("switches an endpoint off", async () => {
    const off = respond(200, { ...hook, state: "disabled" });
    expect(await disableWebhook("s1", "h1", deps, off)).toBe("done");
    expect(await disableWebhook("s1", "h1", deps, respond(404, { code: "not_found" }))).toBe(
      "not_found",
    );
  });
});
