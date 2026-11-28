import { describe, expect, it, vi } from "vitest";
import type { AuthDeps } from "./auth-routes";
import {
  createTrackingLink,
  fetchPublicTracking,
  revokeTrackingLink,
  trackingUrl,
} from "./tracking-links";

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

const link = {
  id: "11111111-1111-4111-8111-111111111111",
  transportId: "22222222-2222-4222-8222-222222222222",
  state: "active",
  expiresAt: "2030-12-30T00:00:00.000Z",
  createdAt: "2030-11-30T00:00:00.000Z",
  revokedAt: null,
  createdBy: { id: "u", displayName: "Dana" },
  token: "tracking-secret_123",
};

describe("tracking links", () => {
  it("builds the customer address", () => {
    expect(trackingUrl("https://app.example.com", "a-b_c")).toBe("https://app.example.com/t/a-b_c");
  });

  it("returns the full link once on creation and maps failures", async () => {
    expect(await createTrackingLink("s1", "t", deps, respond(201, link))).toEqual({
      status: "created",
      url: "https://app.example.com/t/tracking-secret_123",
      expiresAt: "2030-12-30T00:00:00.000Z",
    });
    for (const [status, expected] of [
      [401, "signed_out"],
      [403, "forbidden"],
      [404, "not_found"],
      [409, "closed"],
      [500, "unavailable"],
    ] as const) {
      const result = await createTrackingLink("s1", "t", deps, respond(status, { code: "x" }));
      expect(result.status).toBe(expected);
    }
    expect((await createTrackingLink(undefined, "t", deps, respond(201, link))).status).toBe(
      "signed_out",
    );
  });

  it("sends the address to the API and reports the mail outcome and a missing mail setup", async () => {
    let sent: unknown;
    const spy: typeof fetch = (_url, init) => {
      sent = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      return respond(201, { ...link, mail: { status: "sent", errorCode: null } })(_url, init);
    };
    const created = await createTrackingLink("s1", "t", deps, spy, { emailTo: "c@example.com" });
    expect(sent).toEqual({ emailTo: "c@example.com" });
    expect(created).toMatchObject({ status: "created", mail: "sent" });
    const failed = await createTrackingLink(
      "s1",
      "t",
      deps,
      respond(201, { ...link, mail: { status: "failed", errorCode: "mail_send_failed" } }),
      { emailTo: "c@example.com" },
    );
    expect(failed).toMatchObject({ status: "created", mail: "failed" });
    expect(
      (
        await createTrackingLink("s1", "t", deps, respond(503, { code: "mail_not_configured" }), {
          emailTo: "c@example.com",
        })
      ).status,
    ).toBe("mail_unconfigured");
  });

  it("revokes", async () => {
    expect(await revokeTrackingLink("s1", "l", deps, respond(200, link))).toBe("done");
    expect(await revokeTrackingLink("s1", "l", deps, respond(404, {}))).toBe("not_found");
  });

  it("reads the public view with the token in a header only", async () => {
    let seen: { url: string; token: string | null } | undefined;
    const spy: typeof fetch = (input, init) => {
      seen = {
        url: typeof input === "string" ? input : "",
        token: new Headers(init?.headers).get("x-tracking-token"),
      };
      return Promise.resolve(
        new Response(
          JSON.stringify({
            reference: "LL-000001",
            customerReference: null,
            status: "planned",
            stops: [],
            history: [],
          }),
          { status: 200 },
        ),
      );
    };
    const result = await fetchPublicTracking("http://api.test", "secret-token", spy);
    expect(result.ok).toBe(true);
    expect(seen?.token).toBe("secret-token");
    expect(seen?.url).toBe("http://api.test/v1/tracking/view");
  });

  it("maps public failures", async () => {
    expect(await fetchPublicTracking("http://a", "t", respond(404, {}))).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await fetchPublicTracking("http://a", "t", respond(410, {}))).toEqual({
      ok: false,
      reason: "gone",
    });
    expect(await fetchPublicTracking("http://a", "t", respond(200, { nope: 1 }))).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
