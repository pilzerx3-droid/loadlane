// End-to-end tests of spot freight: tender, carrier links, bids, the human award that assigns the
// transport, and what carriers must never see.
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
type As = { token: string; organizationId: string };

async function body(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

async function workspace() {
  const person = await api.person("spot");
  const organizationId = await api.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles: ["admin"] }],
  });
  const as: As = { token: person.token, organizationId };
  const customer = await body(
    await api.call("/v1/customers", { ...as, json: { name: "Secret Customer Inc" } }),
  );
  const carrier = async (name: string) =>
    String((await body(await api.call("/v1/carriers", { ...as, json: { name } })))["id"]);
  const dallas = await body(
    await api.call("/v1/locations", {
      ...as,
      json: {
        name: "Private Dock",
        addressLine1: "1 Secret Rd",
        city: "Dallas",
        state: "TX",
        postalCode: "75001",
        timezone: "America/Chicago",
      },
    }),
  );
  const houston = await body(
    await api.call("/v1/locations", {
      ...as,
      json: {
        name: "Other Dock",
        addressLine1: "9 Hidden St",
        city: "Houston",
        state: "TX",
        postalCode: "77001",
        timezone: "America/Chicago",
      },
    }),
  );
  const transport = async () => {
    const stop = (type: string, location: Json) => ({
      type,
      locationId: location["id"],
      windowStart: "2030-12-01T14:00:00-06:00",
      windowEnd: "2030-12-01T16:00:00-06:00",
    });
    const made = await body(
      await api.call("/v1/transports", {
        ...as,
        json: {
          customerId: customer["id"],
          weightLb: 12000,
          stops: [stop("pickup", dallas), stop("delivery", houston)],
        },
      }),
    );
    return String(made["id"]);
  };
  const tender = async (transportId: string, carrierIds: string[], extra: Json = {}) =>
    api.call("/v1/spot-tenders", {
      ...as,
      json: { transportId, responseDeadline: inHours(24), carrierIds, ...extra },
    });
  return { as, organizationId, carrier, transport, tender };
}

function carrierCall(token: string, path: string, json?: unknown) {
  return fetch(`${api.baseUrl}/v1/spot/${path}`, {
    method: json === undefined ? "GET" : "POST",
    headers: { "x-spot-token": token, "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
}

describe("creating an offer", () => {
  it("invites carriers, shows links once and stores only hashes", async () => {
    const w = await workspace();
    const [a, b] = [await w.carrier("Blue Line"), await w.carrier("Red Haul")];
    const response = await w.tender(await w.transport(), [a, b], {
      targetPriceCents: 90_000,
      notes: "internal",
    });
    expect(response.status).toBe(201);
    const made = await body(response);
    expect(made).toMatchObject({
      status: "open",
      origin: "Dallas, TX",
      destination: "Houston, TX",
      invited: 2,
      liveBids: 0,
      targetPriceCents: 90_000,
    });
    const links = made["links"] as { carrierId: string; token: string }[];
    expect(links).toHaveLength(2);
    const stored = JSON.stringify(await api.ownerRows("SELECT * FROM spot_invitation"));
    for (const link of links) expect(stored).not.toContain(link.token);
    const read = await body(await api.call(`/v1/spot-tenders/${String(made["id"])}`, w.as));
    expect(JSON.stringify(read)).not.toContain(links[0]?.token);
  });

  it("refuses transports that are not offerable, double offers and bad input", async () => {
    const w = await workspace();
    const carrier = await w.carrier("Blue Line");
    const transportId = await w.transport();
    expect((await w.tender(transportId, [carrier])).status).toBe(201);
    const again = await w.tender(transportId, [carrier]);
    expect(again.status).toBe(409);
    expect((await body(again))["code"]).toBe("tender_already_open");
    expect((await w.tender(await w.transport(), [])).status).toBe(400);
    expect((await w.tender(await w.transport(), [carrier, carrier])).status).toBe(400);
    expect(
      (await w.tender(await w.transport(), ["11111111-1111-4111-8111-111111111111"])).status,
    ).toBe(400);
    expect(
      (await w.tender(await w.transport(), [carrier], { responseDeadline: "2020-01-01T00:00:00Z" }))
        .status,
    ).toBe(400);
    const moving = await w.transport();
    await api.call(`/v1/transports/${moving}/status`, { ...w.as, json: { status: "planned" } });
    expect((await w.tender(moving, [carrier])).status).toBe(201);
  });
});

describe("the carrier's side", () => {
  it("shows the lane but never the customer, address details, target price or other carriers", async () => {
    const w = await workspace();
    const [a, b] = [await w.carrier("Blue Line"), await w.carrier("Red Haul")];
    const made = await body(
      await w.tender(await w.transport(), [a, b], { targetPriceCents: 90_000 }),
    );
    const [first, second] = made["links"] as { token: string }[];
    await carrierCall(String(second?.token), "bid", { priceCents: 70_000 });
    const offer = await body(await carrierCall(String(first?.token), "offer"));
    expect(offer).toMatchObject({ state: "open", weightLb: 12000, yourBid: null });
    expect((offer["stops"] as Json[]).map((stop) => stop["city"])).toEqual(["Dallas", "Houston"]);
    const text = JSON.stringify(offer);
    for (const secret of [
      "Secret Customer",
      "Private Dock",
      "1 Secret Rd",
      "90000",
      "Red Haul",
      "70000",
      "internal",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("takes a bid, replaces it on a new one and lets the carrier withdraw", async () => {
    const w = await workspace();
    const carrier = await w.carrier("Blue Line");
    const made = await body(await w.tender(await w.transport(), [carrier]));
    const token = String(((made["links"] as Json[])[0] as Json)["token"]);
    const first = await body(
      await carrierCall(token, "bid", { priceCents: 88_000, note: "Can load Monday" }),
    );
    expect(first["yourBid"]).toMatchObject({
      priceCents: 88_000,
      status: "submitted",
      note: "Can load Monday",
    });
    const second = await body(await carrierCall(token, "bid", { priceCents: 85_000 }));
    expect(second["yourBid"]).toMatchObject({ priceCents: 85_000, status: "submitted" });
    const detail = await body(await api.call(`/v1/spot-tenders/${String(made["id"])}`, w.as));
    expect((detail["bids"] as Json[]).map((bid) => [bid["priceCents"], bid["status"]])).toEqual([
      [85_000, "submitted"],
      [88_000, "superseded"],
    ]);
    expect(detail).toMatchObject({ liveBids: 1, lowestLiveBidCents: 85_000 });
    const withdrawn = await body(await carrierCall(token, "bid/withdraw", {}));
    expect(withdrawn["yourBid"]).toMatchObject({ status: "withdrawn" });
  });

  it("rejects nonsense prices and bids after the deadline or after the offer closed", async () => {
    const w = await workspace();
    const carrier = await w.carrier("Blue Line");
    const made = await body(await w.tender(await w.transport(), [carrier]));
    const token = String(((made["links"] as Json[])[0] as Json)["token"]);
    for (const bad of [0, -5, 1.5, "cheap"]) {
      expect((await carrierCall(token, "bid", { priceCents: bad })).status).toBe(400);
    }
    await api.asOwner(
      "UPDATE spot_tender SET response_deadline = now() - interval '1 minute' WHERE id = $1",
      [made["id"]],
    );
    const late = await carrierCall(token, "bid", { priceCents: 80_000 });
    expect(late.status).toBe(409);
    expect((await body(late))["code"]).toBe("deadline_passed");
    expect((await body(await carrierCall(token, "offer")))["state"]).toBe("deadline_passed");
    await api.call(`/v1/spot-tenders/${String(made["id"])}/cancel`, { ...w.as, json: {} });
    expect((await body(await carrierCall(token, "offer")))["state"]).toBe("closed");
  });

  it("answers 404 for unknown tokens and 410 for expired or revoked links", async () => {
    const w = await workspace();
    for (const token of ["", "short", "x".repeat(60)])
      expect((await carrierCall(token, "offer")).status).toBe(404);
    const carrier = await w.carrier("Blue Line");
    const made = await body(await w.tender(await w.transport(), [carrier]));
    const token = String(((made["links"] as Json[])[0] as Json)["token"]);
    await api.asOwner(
      "UPDATE spot_invitation SET expires_at = now() - interval '1 minute' WHERE tender_id = $1",
      [made["id"]],
    );
    const gone = await carrierCall(token, "offer");
    expect(gone.status).toBe(410);
    expect((await body(gone))["code"]).toBe("spot_link_expired");
  });
});

describe("staff bids, comparison and the award", () => {
  it("compares bids, awards one, assigns the carrier and writes the history", async () => {
    const w = await workspace();
    const [a, b, c] = [
      await w.carrier("Blue Line"),
      await w.carrier("Red Haul"),
      await w.carrier("Green Co"),
    ];
    const transportId = await w.transport();
    const made = await body(await w.tender(transportId, [a, b]));
    const id = String(made["id"]);
    const links = made["links"] as { carrierId: string; token: string }[];
    await carrierCall(String(links[0]?.token), "bid", { priceCents: 90_000 });
    await carrierCall(String(links[1]?.token), "bid", { priceCents: 82_000 });
    // A price received by phone from a carrier that was never invited by link.
    const entered = await api.call(`/v1/spot-tenders/${id}/bids`, {
      ...w.as,
      json: { carrierId: c, priceCents: 86_000, note: "by phone" },
    });
    expect(entered.status).toBe(201);

    const compared = await body(await api.call(`/v1/spot-tenders/${id}`, w.as));
    const bids = compared["bids"] as Json[];
    expect(bids.map((bid) => bid["priceCents"])).toEqual([82_000, 86_000, 90_000]);
    expect(bids.map((bid) => bid["source"])).toEqual(["carrier_link", "staff", "carrier_link"]);

    // The human chooses the middle bid, not the cheapest.
    const chosen = bids[1] as Json;
    const awarded = await api.call(`/v1/spot-tenders/${id}/award`, {
      ...w.as,
      json: { bidId: chosen["id"], note: "Best on-time record" },
    });
    expect(awarded.status).toBe(200);
    const result = await body(awarded);
    expect(result).toMatchObject({ status: "awarded", transport: { status: "assigned" } });
    expect((result["bids"] as Json[]).map((bid) => bid["status"])).toEqual([
      "rejected",
      "awarded",
      "rejected",
    ]);

    const transport = await body(await api.call(`/v1/transports/${transportId}`, w.as));
    expect(transport).toMatchObject({ status: "assigned", carrier: { name: "Green Co" } });
    const events = transport["events"] as Json[];
    expect(events[0]).toMatchObject({
      toStatus: "assigned",
      fromStatus: "planned",
      source: "user",
    });
    expect(String(events[0]?.["note"])).toContain("$860.00");
    expect(events[1]).toMatchObject({ toStatus: "planned", fromStatus: "created" });
    const audit = await body(await api.call("/v1/audit?entityType=spot_tender", w.as));
    expect((audit["items"] as Json[]).map((item) => item["action"])).toContain(
      "spot_tender.awarded",
    );

    // The winner sees it, the others see only that it closed, and nobody can bid any more.
    expect((await body(await carrierCall(String(links[0]?.token), "offer")))["state"]).toBe(
      "closed",
    );
    expect((await carrierCall(String(links[0]?.token), "bid", { priceCents: 1_000 })).status).toBe(
      409,
    );
    expect((await api.call(`/v1/spot-tenders/${id}/cancel`, { ...w.as, json: {} })).status).toBe(
      409,
    );
  });

  it("only awards a live bid of that offer, once", async () => {
    const w = await workspace();
    const carrier = await w.carrier("Blue Line");
    const made = await body(await w.tender(await w.transport(), [carrier]));
    const id = String(made["id"]);
    const token = String(((made["links"] as Json[])[0] as Json)["token"]);
    await carrierCall(token, "bid", { priceCents: 80_000 });
    await carrierCall(token, "bid", { priceCents: 79_000 });
    const detail = await body(await api.call(`/v1/spot-tenders/${id}`, w.as));
    const superseded = (detail["bids"] as Json[]).find(
      (bid) => bid["status"] === "superseded",
    ) as Json;
    const live = (detail["bids"] as Json[]).find((bid) => bid["status"] === "submitted") as Json;
    const award = (bidId: unknown) =>
      api.call(`/v1/spot-tenders/${id}/award`, { ...w.as, json: { bidId } });
    expect((await award(superseded["id"])).status).toBe(409);
    expect((await award("11111111-1111-4111-8111-111111111111")).status).toBe(400);
    expect((await award(live["id"])).status).toBe(200);
    expect((await award(live["id"])).status).toBe(409);
  });

  it("invites an extra carrier later, and only once", async () => {
    const w = await workspace();
    const [a, b] = [await w.carrier("Blue Line"), await w.carrier("Red Haul")];
    const made = await body(await w.tender(await w.transport(), [a]));
    const id = String(made["id"]);
    const invited = await api.call(`/v1/spot-tenders/${id}/invitations`, {
      ...w.as,
      json: { carrierId: b },
    });
    expect(invited.status).toBe(201);
    expect(((await body(invited))["token"] as string).length).toBeGreaterThanOrEqual(43);
    expect(
      (await api.call(`/v1/spot-tenders/${id}/invitations`, { ...w.as, json: { carrierId: b } }))
        .status,
    ).toBe(409);
  });
});

describe("listing, permissions and isolation", () => {
  it("lists newest first and filters by status", async () => {
    const w = await workspace();
    const carrier = await w.carrier("Blue Line");
    const first = await body(await w.tender(await w.transport(), [carrier]));
    await w.tender(await w.transport(), [carrier]);
    await api.call(`/v1/spot-tenders/${String(first["id"])}/cancel`, { ...w.as, json: {} });
    const all = await body(await api.call("/v1/spot-tenders", w.as));
    expect(all["page"]).toMatchObject({ total: 2 });
    const open = await body(await api.call("/v1/spot-tenders?status=open", w.as));
    expect((open["items"] as Json[]).length).toBe(1);
    expect((await api.call("/v1/spot-tenders?status=banana", w.as)).status).toBe(400);
  });

  it.each([
    ["admin", 200, 201],
    ["dispatcher", 200, 201],
    ["sales", 200, 403],
    ["carrier_user", 403, 403],
  ])("%s: read -> %i, create -> %i", async (role, read, create) => {
    const w = await workspace();
    const carrier = await w.carrier("Blue Line");
    const transportId = await w.transport();
    let as: As = w.as;
    if (role !== "admin") {
      const person = await api.person(role);
      await api.asOwner(
        "INSERT INTO membership (organization_id, user_id, status) VALUES ($1, $2, 'active')",
        [w.organizationId, person.id],
      );
      await api.asOwner(
        "INSERT INTO membership_role (organization_id, membership_id, role_key) SELECT organization_id, id, $3 FROM membership WHERE user_id = $1 AND organization_id = $2",
        [person.id, w.organizationId, role],
      );
      as = { token: person.token, organizationId: w.organizationId };
    }
    expect((await api.call("/v1/spot-tenders", as)).status).toBe(read);
    const response = await api.call("/v1/spot-tenders", {
      ...as,
      json: { transportId, responseDeadline: inHours(5), carrierIds: [carrier] },
    });
    expect(response.status).toBe(create);
  });

  it("keeps offers of one organization invisible and unusable for another", async () => {
    const a = await workspace();
    const b = await workspace();
    const made = await body(await a.tender(await a.transport(), [await a.carrier("Blue Line")]));
    const id = String(made["id"]);
    expect(await body(await api.call("/v1/spot-tenders", b.as))).toMatchObject({ items: [] });
    expect((await api.call(`/v1/spot-tenders/${id}`, b.as)).status).toBe(404);
    expect((await api.call(`/v1/spot-tenders/${id}/cancel`, { ...b.as, json: {} })).status).toBe(
      404,
    );
    // B cannot offer A's transport or invite A's carrier.
    const foreignTransport = String(
      ((await body(await api.call(`/v1/spot-tenders/${id}`, a.as)))["transport"] as Json)["id"],
    );
    const response = await api.call("/v1/spot-tenders", {
      ...b.as,
      json: {
        transportId: foreignTransport,
        responseDeadline: inHours(5),
        carrierIds: [await b.carrier("Own")],
      },
    });
    expect(response.status).toBe(400);
  });
});
