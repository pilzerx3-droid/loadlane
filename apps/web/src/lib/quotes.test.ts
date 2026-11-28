import { describe, expect, it, vi } from "vitest";
import type { AuthDeps } from "./auth-routes";
import { emailQuote } from "./quotes";

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

describe("emailQuote", () => {
  it("sends no address when the field is empty and reports who got the mail", async () => {
    let sent: unknown;
    const spy: typeof fetch = (url, init) => {
      sent = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      return respond(200, { to: "buyer@acme.example", status: "sent", errorCode: null })(url, init);
    };
    expect(await emailQuote("s1", "q", "", deps, spy)).toEqual({
      status: "sent",
      to: "buyer@acme.example",
    });
    expect(sent).toEqual({});
    await emailQuote("s1", "q", "ap@acme.example", deps, spy);
    expect(sent).toEqual({ to: "ap@acme.example" });
  });

  it("maps a failed send and every error the API answers", async () => {
    expect(
      (
        await emailQuote(
          "s1",
          "q",
          "",
          deps,
          respond(200, { to: "a@b.co", status: "failed", errorCode: "mail_send_failed" }),
        )
      ).status,
    ).toBe("send_failed");
    for (const [status, body, expected] of [
      [401, { code: "x" }, "signed_out"],
      [403, { code: "x" }, "forbidden"],
      [404, { code: "x" }, "not_found"],
      [409, { code: "quote_not_sendable" }, "not_sendable"],
      [503, { code: "mail_not_configured" }, "mail_unconfigured"],
      [500, { code: "x" }, "unavailable"],
    ] as const) {
      expect((await emailQuote("s1", "q", "", deps, respond(status, body))).status).toBe(expected);
    }
    expect((await emailQuote(undefined, "q", "", deps, respond(200, {}))).status).toBe(
      "signed_out",
    );
  });
});
