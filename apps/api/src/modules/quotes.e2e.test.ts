// End-to-end tests of quotes: creation from a frozen calculation, numbering, the status model,
// editing rules, validity dates, permissions and tenant isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "../testing/harness.ts";

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
});

type Json = Record<string, unknown>;

async function body(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

const lines = [{ kind: "base_freight", label: "Carrier rate", amountCents: 90_000 }];
const future = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function workspace(role = "admin") {
  const person = await api.person("quotes");
  const organizationId = await api.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles: [role] }],
  });
  const as = { token: person.token, organizationId };
  const customer = await body(await api.call("/v1/customers", { ...as, json: { name: "Acme" } }));
  return { as, organizationId, customerId: customer["id"] as string | undefined };
}

async function adminWorkspace() {
  const w = await workspace();
  const calc = async (customerId: string | null = w.customerId ?? null) =>
    body(
      await api.call("/v1/calculations", {
        ...w.as,
        json: {
          name: "Dallas to Houston",
          ...(customerId ? { customerId } : {}),
          lines,
          pricing: { mode: "markup", rateBp: 1_500 },
        },
      }),
    );
  const quote = async (calculationId: string, extra: Json = {}) =>
    api.call("/v1/quotes", {
      ...w.as,
      json: { calculationId, validUntil: future(14), ...extra },
    });
  return { ...w, calc, quote };
}

describe("creating quotes", () => {
  it("offers the price of a frozen calculation and numbers quotes per organization", async () => {
    const w = await adminWorkspace();
    const calculation = await w.calc();
    const first = await w.quote(String(calculation["id"]), { terms: "Net 30", notes: "internal" });
    expect(first.status).toBe(201);
    const made = await body(first);
    expect(made).toMatchObject({
      number: 1,
      reference: "QT-000001",
      status: "draft",
      priceCents: 103_500,
      customer: { name: "Acme" },
      calculationName: "Dallas to Houston",
      terms: "Net 30",
      editable: true,
      expired: false,
      allowedStatuses: ["sent", "cancelled"],
      calculation: { costCents: 90_000, contributionCents: 13_500, markupBp: 1_500 },
    });
    const second = await body(await w.quote(String(calculation["id"])));
    expect(second["reference"]).toBe("QT-000002");
  });

  it("needs a customer from the calculation or the request, and they must match", async () => {
    const w = await adminWorkspace();
    const noCustomer = await w.calc(null);
    const missing = await w.quote(String(noCustomer["id"]));
    expect(missing.status).toBe(400);
    const chosen = await body(
      await w.quote(String(noCustomer["id"]), { customerId: w.customerId }),
    );
    expect(chosen["customer"]).toMatchObject({ name: "Acme" });

    const other = await body(await api.call("/v1/customers", { ...w.as, json: { name: "Other" } }));
    const withCustomer = await w.calc();
    expect((await w.quote(String(withCustomer["id"]), { customerId: other["id"] })).status).toBe(
      400,
    );
  });

  it("rejects unknown calculations, past dates and malformed input", async () => {
    const w = await adminWorkspace();
    const calculation = String((await w.calc())["id"]);
    expect((await w.quote("11111111-1111-4111-8111-111111111111")).status).toBe(400);
    expect((await w.quote(calculation, { validUntil: "2020-01-01" })).status).toBe(400);
    expect((await w.quote(calculation, { validUntil: "tomorrow" })).status).toBe(400);
    expect((await w.quote(calculation, { price: 1 })).status).toBe(400);
  });
});

describe("status model and editing", () => {
  it("goes draft -> sent -> accepted with timestamps and refuses other paths", async () => {
    const w = await adminWorkspace();
    const made = await body(await w.quote(String((await w.calc())["id"])));
    const id = String(made["id"]);
    const move = (status: string) =>
      api.call(`/v1/quotes/${id}/status`, { ...w.as, json: { status } });

    expect((await move("accepted")).status).toBe(409); // cannot skip "sent"
    const sent = await body(await move("sent"));
    expect(sent).toMatchObject({
      status: "sent",
      editable: false,
      allowedStatuses: ["accepted", "rejected", "cancelled"],
    });
    expect(sent["sentAt"]).toBeTruthy();
    const accepted = await body(await move("accepted"));
    expect(accepted["status"]).toBe("accepted");
    expect(accepted["decidedAt"]).toBeTruthy();
    expect((await move("rejected")).status).toBe(409); // final
  });

  it("edits only drafts, and never the price", async () => {
    const w = await adminWorkspace();
    const made = await body(await w.quote(String((await w.calc())["id"])));
    const id = String(made["id"]);
    const patched = await body(
      await api.call(`/v1/quotes/${id}`, {
        ...w.as,
        method: "PATCH",
        json: { terms: "Net 45", validUntil: future(30) },
      }),
    );
    expect(patched).toMatchObject({ terms: "Net 45", validUntil: future(30), priceCents: 103_500 });
    expect(
      (await api.call(`/v1/quotes/${id}`, { ...w.as, method: "PATCH", json: { priceCents: 1 } }))
        .status,
    ).toBe(400);
    await api.call(`/v1/quotes/${id}/status`, { ...w.as, json: { status: "sent" } });
    const locked = await api.call(`/v1/quotes/${id}`, {
      ...w.as,
      method: "PATCH",
      json: { terms: "x" },
    });
    expect(locked.status).toBe(409);
    expect((await body(locked))["code"]).toBe("quote_not_editable");
  });

  it("shows a sent quote as expired once its date passed, and refuses to accept it", async () => {
    const w = await adminWorkspace();
    const made = await body(await w.quote(String((await w.calc())["id"])));
    const id = String(made["id"]);
    await api.call(`/v1/quotes/${id}/status`, { ...w.as, json: { status: "sent" } });
    await api.asOwner("UPDATE quote SET valid_until = current_date - 5 WHERE id = $1", [id]);
    const read = await body(await api.call(`/v1/quotes/${id}`, w.as));
    expect(read).toMatchObject({ status: "sent", expired: true });
    const accept = await api.call(`/v1/quotes/${id}/status`, {
      ...w.as,
      json: { status: "accepted" },
    });
    expect(accept.status).toBe(409);
    expect((await body(accept))["code"]).toBe("quote_expired");
    expect(
      (await api.call(`/v1/quotes/${id}/status`, { ...w.as, json: { status: "rejected" } })).status,
    ).toBe(200);
  });

  it("keeps the offered price when the calculation list grows", async () => {
    const w = await adminWorkspace();
    const made = await body(await w.quote(String((await w.calc())["id"])));
    await w.calc();
    const read = await body(await api.call(`/v1/quotes/${String(made["id"])}`, w.as));
    expect(read["priceCents"]).toBe(103_500);
  });
});

describe("listing, permissions and isolation", () => {
  it("lists newest first and filters by status", async () => {
    const w = await adminWorkspace();
    const calculation = String((await w.calc())["id"]);
    const a = await body(await w.quote(calculation));
    await w.quote(calculation);
    await api.call(`/v1/quotes/${String(a["id"])}/status`, { ...w.as, json: { status: "sent" } });
    const all = await body(await api.call("/v1/quotes", w.as));
    expect((all["items"] as Json[]).map((item) => item["number"])).toEqual([2, 1]);
    const sent = await body(await api.call("/v1/quotes?status=sent", w.as));
    expect((sent["items"] as Json[]).map((item) => item["number"])).toEqual([1]);
    expect((await api.call("/v1/quotes?status=banana", w.as)).status).toBe(400);
  });

  it.each([
    ["admin", 200, 201],
    ["dispatcher", 200, 403],
    ["sales", 200, 201],
    ["carrier_user", 403, 403],
  ])("%s: read -> %i, create -> %i", async (role, read, create) => {
    const admin = await adminWorkspace();
    const calculation = String((await admin.calc())["id"]);
    const member = role === "admin" ? admin.as : await memberOf(admin.organizationId, role);
    expect((await api.call("/v1/quotes", member)).status).toBe(read);
    const response = await api.call("/v1/quotes", {
      ...member,
      json: { calculationId: calculation, validUntil: future(7) },
    });
    expect(response.status).toBe(create);
  });

  it("keeps quotes of one organization invisible to another and writes audit entries", async () => {
    const a = await adminWorkspace();
    const b = await adminWorkspace();
    const made = await body(await a.quote(String((await a.calc())["id"])));
    expect(await body(await api.call("/v1/quotes", b.as))).toMatchObject({ items: [] });
    expect((await api.call(`/v1/quotes/${String(made["id"])}`, b.as)).status).toBe(404);
    expect(
      (
        await api.call(`/v1/quotes/${String(made["id"])}/status`, {
          ...b.as,
          json: { status: "sent" },
        })
      ).status,
    ).toBe(404);
    // B cannot quote A's calculation either.
    const foreign = await api.call("/v1/quotes", {
      ...b.as,
      json: {
        calculationId: made["calculation"] && (made["calculation"] as Json)["id"],
        validUntil: future(5),
        customerId: b.customerId,
      },
    });
    expect(foreign.status).toBe(400);
    const audit = await body(await api.call("/v1/audit?entityType=quote", a.as));
    expect((audit["items"] as Json[]).map((item) => item["action"])).toEqual(["quote.created"]);
  });
});

async function memberOf(organizationId: string, role: string) {
  const person = await api.person(role);
  await api.asOwner(
    "INSERT INTO membership (organization_id, user_id, status) VALUES ($1, $2, 'active')",
    [organizationId, person.id],
  );
  await api.asOwner(
    "INSERT INTO membership_role (organization_id, membership_id, role_key) SELECT organization_id, id, $3 FROM membership WHERE user_id = $1 AND organization_id = $2",
    [person.id, organizationId, role],
  );
  return { token: person.token, organizationId };
}
