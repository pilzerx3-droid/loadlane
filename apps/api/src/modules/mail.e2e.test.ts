// End-to-end tests of outgoing e-mail (ADR 0021) with an in-memory provider (MOCK: nothing leaves the
// process): tracking links, spot invitations and quotes, the log, failures, permissions and isolation.
// The SMTP adapter itself is tested against a local Mailpit in smtp-mail.e2e.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryMailProvider } from "../platform/mail.ts";
import { startTestApi, type TestApi } from "../testing/harness.ts";

let api: TestApi;
let plain: TestApi;
const mail = new MemoryMailProvider();

beforeAll(async () => {
  api = await startTestApi({ mail });
  plain = await startTestApi(); // no mail provider: sending answers 503
});

afterAll(async () => {
  await api.close();
  await plain.close();
});

type Json = Record<string, unknown>;

async function body(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

const future = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function workspace(target: TestApi, role = "admin") {
  const person = await target.person("mail");
  const organizationId = await target.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles: [role] }],
    name: "North Star Freight",
  });
  const as = { token: person.token, organizationId };
  const post = async (path: string, json: unknown) =>
    body(await target.call(path, { ...as, json }));
  const customer = await post("/v1/customers", {
    name: "Acme",
    contactEmail: "buyer@acme.example",
  });
  const location = await post("/v1/locations", {
    name: "Dock 4",
    addressLine1: "1 Private Rd",
    city: "Dallas",
    state: "TX",
    postalCode: "75001",
    timezone: "America/Chicago",
  });
  const stop = (type: string) => ({
    type,
    locationId: location["id"],
    windowStart: "2030-12-01T14:00:00-06:00",
    windowEnd: "2030-12-01T16:00:00-06:00",
  });
  const transport = await post("/v1/transports", {
    customerId: customer["id"],
    stops: [stop("pickup"), stop("delivery")],
  });
  return { as, organizationId, post, customer, transportId: String(transport["id"]) };
}

describe("tracking link e-mail", () => {
  it("sends the link, logs the mail without body or token, and still shows the link once", async () => {
    const w = await workspace(api);
    mail.sent.length = 0;
    const response = await api.call(`/v1/transports/${w.transportId}/tracking-links`, {
      ...w.as,
      json: { emailTo: "customer@example.com", expiresInDays: 10 },
    });
    expect(response.status).toBe(201);
    const created = await body(response);
    expect(created["mail"]).toEqual({ status: "sent", errorCode: null });
    expect(mail.sent).toHaveLength(1);
    const message = mail.sent[0];
    expect(message?.to).toBe("customer@example.com");
    expect(message?.subject).toBe(`Track shipment ${String(created["reference"])}`);
    expect(message?.text).toContain(`http://localhost:3000/t/${String(created["token"])}`);
    expect(message?.text).toContain("North Star Freight");

    const rows = await api.ownerRows("SELECT * FROM mail_log WHERE organization_id = $1", [
      w.organizationId,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "tracking_link",
      recipient: "customer@example.com",
      status: "sent",
      related_id: w.transportId,
    });
    expect(JSON.stringify(rows)).not.toContain(String(created["token"]));

    const log = await body(await api.call("/v1/mail-log", w.as));
    expect(log["items"]).toHaveLength(1);
    expect((log["items"] as Json[])[0]).toMatchObject({
      recipient: "customer@example.com",
      status: "sent",
    });
  });

  it("creates a link without any mail when no address is given", async () => {
    const w = await workspace(api);
    mail.sent.length = 0;
    const created = await body(
      await api.call(`/v1/transports/${w.transportId}/tracking-links`, { ...w.as, json: {} }),
    );
    expect(created["mail"]).toBeUndefined();
    expect(mail.sent).toHaveLength(0);
  });

  it("reports a failed send, keeps the link and logs the failure without the provider's message", async () => {
    const w = await workspace(api);
    mail.failWith = new Error("535 login failed for secret-account@smtp.internal");
    try {
      const response = await api.call(`/v1/transports/${w.transportId}/tracking-links`, {
        ...w.as,
        json: { emailTo: "customer@example.com" },
      });
      expect(response.status).toBe(201);
      const created = await body(response);
      expect(created["token"]).toEqual(expect.any(String));
      expect(created["mail"]).toEqual({ status: "failed", errorCode: "mail_send_failed" });
      expect(JSON.stringify(created)).not.toContain("secret-account");
      const rows = await api.ownerRows(
        "SELECT status, error_code FROM mail_log WHERE organization_id = $1",
        [w.organizationId],
      );
      expect(rows).toEqual([{ status: "failed", error_code: "mail_send_failed" }]);
    } finally {
      mail.failWith = undefined;
    }
  });

  it("refuses with 503 before creating a link when mail is not configured", async () => {
    const w = await workspace(plain);
    const response = await plain.call(`/v1/transports/${w.transportId}/tracking-links`, {
      ...w.as,
      json: { emailTo: "customer@example.com" },
    });
    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({ code: "mail_not_configured" });
    const links = await body(
      await plain.call(`/v1/transports/${w.transportId}/tracking-links`, w.as),
    );
    expect(links["items"]).toEqual([]);
    // Without an address nothing changes: links work without mail.
    const plainLink = await plain.call(`/v1/transports/${w.transportId}/tracking-links`, {
      ...w.as,
      json: {},
    });
    expect(plainLink.status).toBe(201);
  });

  it("rejects an invalid address", async () => {
    const w = await workspace(api);
    const response = await api.call(`/v1/transports/${w.transportId}/tracking-links`, {
      ...w.as,
      json: { emailTo: "not-an-address" },
    });
    expect(response.status).toBe(400);
  });
});

describe("mail log", () => {
  it("is limited to the own organization and to people who may read the audit trail", async () => {
    const a = await workspace(api);
    const b = await workspace(api);
    await api.call(`/v1/transports/${a.transportId}/tracking-links`, {
      ...a.as,
      json: { emailTo: "a@example.com" },
    });
    expect(
      ((await body(await api.call("/v1/mail-log", b.as)))["items"] as Json[]).map(
        (item) => item["recipient"],
      ),
    ).toEqual([]);
    expect(((await body(await api.call("/v1/mail-log", a.as)))["items"] as Json[]).length).toBe(1);
    const sales = await api.person("sales");
    const salesOrg = await api.seedOrganization({
      creatorUserId: sales.id,
      members: [{ userId: sales.id, roles: ["sales"] }],
    });
    const denied = await api.call("/v1/mail-log", { token: sales.token, organizationId: salesOrg });
    expect(denied.status).toBe(403);
  });
});

describe("spot invitation e-mail", () => {
  it("mails each carrier its own link and skips a carrier without an address", async () => {
    const w = await workspace(api);
    const withMail = await w.post("/v1/carriers", {
      name: "Fast Haul",
      contactEmail: "dispatch@fasthaul.example",
    });
    const without = await w.post("/v1/carriers", { name: "No Mail Trucking" });
    mail.sent.length = 0;
    const response = await api.call("/v1/spot-tenders", {
      ...w.as,
      json: {
        transportId: w.transportId,
        responseDeadline: new Date(Date.now() + 86_400_000).toISOString(),
        carrierIds: [withMail["id"], without["id"]],
        sendEmail: true,
      },
    });
    expect(response.status).toBe(201);
    const created = await body(response);
    const links = created["links"] as { carrierId: string; token: string }[];
    expect(created["mail"]).toEqual([
      { carrierId: withMail["id"], status: "sent", errorCode: null },
      { carrierId: without["id"], status: "skipped", errorCode: "no_contact_email" },
    ]);
    expect(mail.sent).toHaveLength(1);
    const token = links.find((link) => link.carrierId === withMail["id"])?.token ?? "";
    expect(mail.sent[0]?.to).toBe("dispatch@fasthaul.example");
    expect(mail.sent[0]?.text).toContain(`/s/${token}`);
    expect(mail.sent[0]?.text).toContain("Hello Fast Haul");
    // The e-mail carries the lane, never the customer or the internal target price.
    expect(mail.sent[0]?.text).not.toContain("Acme");
    expect(mail.sent[0]?.text).not.toContain("1 Private Rd");
    const rows = await api.ownerRows(
      "SELECT kind, status FROM mail_log WHERE organization_id = $1",
      [w.organizationId],
    );
    expect(rows).toEqual([{ kind: "spot_invitation", status: "sent" }]);
  });

  it("can e-mail a later invitation", async () => {
    const w = await workspace(api);
    const first = await w.post("/v1/carriers", { name: "First", contactEmail: "a@first.example" });
    const second = await w.post("/v1/carriers", {
      name: "Second",
      contactEmail: "b@second.example",
    });
    const created = await body(
      await api.call("/v1/spot-tenders", {
        ...w.as,
        json: {
          transportId: w.transportId,
          responseDeadline: new Date(Date.now() + 86_400_000).toISOString(),
          carrierIds: [first["id"]],
        },
      }),
    );
    mail.sent.length = 0;
    const invited = await api.call(`/v1/spot-tenders/${String(created["id"])}/invitations`, {
      ...w.as,
      json: { carrierId: second["id"], sendEmail: true },
    });
    expect(invited.status).toBe(201);
    expect((await body(invited))["mail"]).toMatchObject({ status: "sent" });
    expect(mail.sent.map((message) => message.to)).toEqual(["b@second.example"]);
  });
});

describe("quote e-mail", () => {
  async function sentQuote(w: Awaited<ReturnType<typeof workspace>>, markSent = true) {
    const calculation = await w.post("/v1/calculations", {
      name: "Dallas to Houston",
      customerId: w.customer["id"],
      lines: [{ kind: "base_freight", label: "Carrier rate", amountCents: 90_000 }],
      pricing: { mode: "markup", rateBp: 1_500 },
    });
    const quote = await w.post("/v1/quotes", {
      calculationId: calculation["id"],
      validUntil: future(14),
    });
    const id = String(quote["id"]);
    if (markSent) await w.post(`/v1/quotes/${id}/status`, { status: "sent" });
    return id;
  }

  it("sends the PDF to the customer's contact address, or to an address given", async () => {
    const w = await workspace(api);
    const id = await sentQuote(w);
    mail.sent.length = 0;
    const response = await api.call(`/v1/quotes/${id}/email`, { ...w.as, json: {} });
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      to: "buyer@acme.example",
      status: "sent",
      errorCode: null,
    });
    const message = mail.sent[0];
    expect(message?.to).toBe("buyer@acme.example");
    expect(message?.subject).toContain("QT-000001");
    expect(message?.attachments?.[0]).toMatchObject({
      filename: "QT-000001.pdf",
      contentType: "application/pdf",
    });
    expect(message?.attachments?.[0]?.content.subarray(0, 5).toString()).toBe("%PDF-");
    expect(message?.text).not.toContain("90000");

    const other = await body(
      await api.call(`/v1/quotes/${id}/email`, { ...w.as, json: { to: "ap@acme.example" } }),
    );
    expect(other["to"]).toBe("ap@acme.example");
  });

  it("only mails a quote that was marked as sent", async () => {
    const w = await workspace(api);
    const id = await sentQuote(w, false);
    const response = await api.call(`/v1/quotes/${id}/email`, { ...w.as, json: {} });
    expect(response.status).toBe(409);
    expect(await body(response)).toMatchObject({ code: "quote_not_sendable" });
  });

  it("asks for an address when the customer has none", async () => {
    const w = await workspace(api);
    const bare = await w.post("/v1/customers", { name: "No Mail Customer" });
    const calculation = await w.post("/v1/calculations", {
      name: "Lane",
      customerId: bare["id"],
      lines: [{ kind: "base_freight", label: "Carrier rate", amountCents: 50_000 }],
      pricing: { mode: "markup", rateBp: 1_000 },
    });
    const quote = await w.post("/v1/quotes", {
      calculationId: calculation["id"],
      validUntil: future(7),
    });
    const id = String(quote["id"]);
    await w.post(`/v1/quotes/${id}/status`, { status: "sent" });
    const response = await api.call(`/v1/quotes/${id}/email`, { ...w.as, json: {} });
    expect(response.status).toBe(400);
  });

  it("answers 503 when mail is not configured and 404 for another organization's quote", async () => {
    const w = await workspace(plain);
    const calculation = await w.post("/v1/calculations", {
      name: "Lane",
      customerId: w.customer["id"],
      lines: [{ kind: "base_freight", label: "Carrier rate", amountCents: 50_000 }],
      pricing: { mode: "markup", rateBp: 1_000 },
    });
    const quote = await w.post("/v1/quotes", {
      calculationId: calculation["id"],
      validUntil: future(7),
    });
    const id = String(quote["id"]);
    expect((await plain.call(`/v1/quotes/${id}/email`, { ...w.as, json: {} })).status).toBe(503);

    const mine = await workspace(api);
    const foreign = await workspace(api);
    const foreignId = await sentQuote(foreign);
    const response = await api.call(`/v1/quotes/${foreignId}/email`, { ...mine.as, json: {} });
    expect(response.status).toBe(404);
  });
});
