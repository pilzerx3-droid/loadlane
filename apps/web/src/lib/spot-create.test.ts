import { describe, expect, it, vi } from "vitest";
import type { AuthDeps } from "./auth-routes";
import { createTender } from "./spot";

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

const tender = {
  transportId: "t",
  responseDeadline: "2030-12-01T00:00:00.000Z",
  targetPriceCents: null,
  notes: "",
  carrierIds: ["c1", "c2"],
  carrierNames: { c1: "Fast Haul", c2: "No Mail Trucking" },
};

const detail = {
  id: "d1",
  status: "open",
  transport: { id: "t", reference: "LL-000001", status: "planned" },
  origin: "Dallas, TX",
  destination: "Houston, TX",
  responseDeadline: "2030-12-01T00:00:00.000Z",
  deadlinePassed: false,
  invited: 2,
  liveBids: 0,
  lowestLiveBidCents: null,
  createdAt: "2030-11-30T00:00:00.000Z",
  targetPriceCents: null,
  notes: null,
  awardedAt: null,
  awardedBy: null,
  stops: [],
  invitations: [],
  bids: [],
};

function respond(status: number, body: unknown, capture?: (sent: unknown) => void): typeof fetch {
  return (_url, init) => {
    if (capture) capture(JSON.parse(typeof init?.body === "string" ? init.body : "{}"));
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
}

describe("createTender with e-mail", () => {
  it("asks the API to send mail and reports the status per carrier", async () => {
    let sent: Record<string, unknown> = {};
    const result = await createTender(
      "s1",
      { ...tender, sendEmail: true },
      deps,
      respond(
        201,
        {
          ...detail,
          links: [
            { carrierId: "c1", token: "tok-one" },
            { carrierId: "c2", token: "tok-two" },
          ],
          mail: [
            { carrierId: "c1", status: "sent", errorCode: null },
            { carrierId: "c2", status: "skipped", errorCode: "no_contact_email" },
          ],
        },
        (body) => (sent = body as Record<string, unknown>),
      ),
    );
    expect(sent["sendEmail"]).toBe(true);
    expect(result).toMatchObject({
      status: "created",
      links: [
        { carrierName: "Fast Haul", url: "https://app.example.com/s/tok-one", mail: "sent" },
        { carrierName: "No Mail Trucking", mail: "skipped" },
      ],
    });
  });

  it("does not ask for mail by default and has no mail status then", async () => {
    let sent: Record<string, unknown> = {};
    const result = await createTender(
      "s1",
      tender,
      deps,
      respond(
        201,
        { ...detail, links: [{ carrierId: "c1", token: "tok-one" }] },
        (body) => (sent = body as Record<string, unknown>),
      ),
    );
    expect(sent).not.toHaveProperty("sendEmail");
    expect(result.status === "created" && result.links[0]?.mail).toBeFalsy();
  });

  it("explains a server without mail setup", async () => {
    const result = await createTender(
      "s1",
      { ...tender, sendEmail: true },
      deps,
      respond(503, { code: "mail_not_configured" }),
    );
    expect(result.status).toBe("mail_unconfigured");
  });
});
