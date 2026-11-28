// End-to-end tests of outgoing webhooks (ADR 0022): registering an endpoint, the outbox written by
// the database when a transport changes status, signed delivery to a local receiver, retries,
// disabled endpoints, and permissions and isolation.
import { createHmac, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dispatchWebhooks, postOnce } from "@loadlane/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "../testing/harness.ts";

const key = randomBytes(32);
let api: TestApi;
let plain: TestApi;
let receiver: Server;
let receiverUrl = "";
let answer = 200;
const calls: {
  path: string;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}[] = [];

beforeAll(async () => {
  api = await startTestApi({ webhook: { key, allowPrivate: true } });
  plain = await startTestApi();
  receiver = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      calls.push({
        path: request.url ?? "",
        body: Buffer.concat(chunks).toString(),
        headers: request.headers,
      });
      response.writeHead(answer);
      response.end();
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
});

afterAll(async () => {
  receiver.close();
  await api.close();
  await plain.close();
});

type Json = Record<string, unknown>;

async function body(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

async function workspace(target: TestApi, role = "admin") {
  const person = await target.person("hooks");
  const organizationId = await target.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles: [role] }],
  });
  const as = { token: person.token, organizationId };
  const post = async (path: string, json: unknown) =>
    body(await target.call(path, { ...as, json }));
  const place = await post("/v1/locations", {
    name: "Dock",
    addressLine1: "1 Main",
    city: "Dallas",
    state: "TX",
    postalCode: "75001",
    timezone: "America/Chicago",
  });
  const customer = await post("/v1/customers", { name: "Acme" });
  const transport = async () => {
    const stop = (type: string) => ({
      type,
      locationId: place["id"],
      windowStart: "2030-12-01T14:00:00-06:00",
      windowEnd: "2030-12-01T16:00:00-06:00",
    });
    const made = await post("/v1/transports", {
      customerId: customer["id"],
      notes: "secret internal note",
      stops: [stop("pickup"), stop("delivery")],
    });
    return String(made["id"]);
  };
  const register = (url = `${receiverUrl}/hook`) => post("/v1/webhooks", { url });
  return { as, organizationId, person, post, transport, register };
}

const dispatch = (target: TestApi, now = new Date()) =>
  dispatchWebhooks(target.db.appPool, { key, allowPrivate: true, now });

describe("registering endpoints", () => {
  it("shows the secret once and stores it only encrypted", async () => {
    const w = await workspace(api);
    const created = await w.register();
    expect(created["secret"]).toMatch(/^whsec_/);
    expect(created).toMatchObject({ state: "active", events: ["transport.status_changed"] });
    const stored = await api.ownerRows(
      "SELECT secret_encrypted FROM webhook_endpoint WHERE id = $1",
      [created["id"]],
    );
    expect(String(stored[0]?.["secret_encrypted"])).not.toContain(String(created["secret"]));
    const listed = await body(await api.call("/v1/webhooks", w.as));
    expect(JSON.stringify(listed)).not.toContain(String(created["secret"]));
    expect((listed["items"] as Json[]).map((item) => item["id"])).toEqual([created["id"]]);
  });

  it("refuses without an encryption key (503), a bad address, other events and missing permission", async () => {
    const off = await workspace(plain);
    const refused = await plain.call("/v1/webhooks", {
      ...off.as,
      json: { url: "https://h.example.com" },
    });
    expect(refused.status).toBe(503);
    expect(await body(refused)).toMatchObject({ code: "webhooks_not_configured" });

    const w = await workspace(api);
    for (const json of [
      { url: "ftp://hooks.example.com" },
      { url: "not a url" },
      { url: "https://user:pw@hooks.example.com" },
      { url: "https://hooks.example.com", events: ["quote.sent"] },
      { url: "https://hooks.example.com", extra: true },
    ]) {
      expect((await api.call("/v1/webhooks", { ...w.as, json })).status, JSON.stringify(json)).toBe(
        400,
      );
    }
    const sales = await workspace(api, "sales");
    expect((await api.call("/v1/webhooks", sales.as)).status).toBe(403);
  });

  it("is isolated per organization", async () => {
    const a = await workspace(api);
    const b = await workspace(api);
    const created = await a.register();
    expect((await body(await api.call("/v1/webhooks", b.as)))["items"] as Json[]).toEqual([]);
    expect(
      (await api.call(`/v1/webhooks/${String(created["id"])}/disable`, { ...b.as, json: {} }))
        .status,
    ).toBe(404);
    expect((await api.call(`/v1/webhooks/${String(created["id"])}/deliveries`, b.as)).status).toBe(
      404,
    );
  });
});

describe("events and delivery", () => {
  it("queues every status change, delivers a signed call with no internal data, and records the outcome", async () => {
    const w = await workspace(api);
    const endpoint = await w.register();
    answer = 200;
    calls.length = 0;
    const transportId = await w.transport();
    await w.post(`/v1/transports/${transportId}/status`, {
      status: "planned",
      note: "private note",
    });
    const queued = await api.ownerRows(
      "SELECT status, payload FROM webhook_delivery WHERE endpoint_id = $1 ORDER BY created_at",
      [endpoint["id"]],
    );
    expect(queued).toHaveLength(2); // created, then planned
    expect(await dispatch(api)).toMatchObject({ attempted: 2, delivered: 2 });
    const mine = calls.filter((call) => call.path === "/hook");
    expect(mine).toHaveLength(2);
    const last = mine[1];
    const payload = JSON.parse(last?.body ?? "{}") as Json;
    expect(payload).toMatchObject({
      type: "transport.status_changed",
      data: { transportId, fromStatus: "created", toStatus: "planned", externalId: null },
    });
    expect((payload["data"] as Json)["reference"]).toMatch(/^LL-\d{6}$/);
    expect(last?.body).not.toContain("private note");
    expect(last?.body).not.toContain("secret internal note");
    // The receiver can verify the call with the secret it was shown.
    const header = String(last?.headers["x-loadlane-signature"]);
    const [t, v1] = header.split(",").map((part) => part.split("=")[1]);
    const expected = createHmac("sha256", String(endpoint["secret"]))
      .update(`${t}.${last?.body}`)
      .digest("hex");
    expect(v1).toBe(expected);
    expect(last?.headers["x-loadlane-event"]).toBe("transport.status_changed");
    expect(last?.headers["x-loadlane-event-id"]).toBe(payload["id"]);
    const deliveries = await body(
      await api.call(`/v1/webhooks/${String(endpoint["id"])}/deliveries`, w.as),
    );
    expect(
      (deliveries["items"] as Json[]).map((item) => [item["status"], item["lastStatusCode"]]),
    ).toEqual([
      ["delivered", 200],
      ["delivered", 200],
    ]);
    // Delivered events are not sent again.
    calls.length = 0;
    await dispatch(api);
    expect(calls.filter((call) => call.path === "/hook")).toHaveLength(0);
  });

  it("retries a failing receiver later and gives up after the last attempt", async () => {
    const w = await workspace(api);
    const endpoint = await w.register(`${receiverUrl}/flaky`);
    await w.transport();
    answer = 500;
    const start = new Date();
    await dispatch(api, start);
    let rows = await api.ownerRows(
      "SELECT status, attempts, last_status_code, last_error_code, next_attempt_at FROM webhook_delivery WHERE endpoint_id = $1",
      [endpoint["id"]],
    );
    expect(rows[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      last_status_code: 500,
      last_error_code: "http_500",
    });
    expect(new Date(String(rows[0]?.["next_attempt_at"])).getTime()).toBeGreaterThanOrEqual(
      start.getTime() + 59_000,
    );
    // Not due yet: nothing is sent.
    calls.length = 0;
    await dispatch(api, new Date(start.getTime() + 30_000));
    expect(calls.filter((call) => call.path === "/flaky")).toHaveLength(0);
    // Each later time it is due, it is tried again until the sixth failure.
    let now = start.getTime();
    for (const wait of [61_000, 301_000, 1_801_000, 7_201_000, 43_201_000]) {
      now += wait;
      await dispatch(api, new Date(now));
    }
    rows = await api.ownerRows(
      "SELECT status, attempts FROM webhook_delivery WHERE endpoint_id = $1",
      [endpoint["id"]],
    );
    expect(rows[0]).toMatchObject({ status: "failed", attempts: 6 });
    // A recovered receiver gets nothing more for a failed delivery.
    answer = 200;
    calls.length = 0;
    await dispatch(api, new Date(now + 3_600_000));
    expect(calls.filter((call) => call.path === "/flaky")).toHaveLength(0);
    answer = 200;
  });

  it("delivers on a later attempt once the receiver recovers", async () => {
    const w = await workspace(api);
    const endpoint = await w.register(`${receiverUrl}/recover`);
    await w.transport();
    answer = 503;
    const start = new Date();
    await dispatch(api, start);
    answer = 200;
    await dispatch(api, new Date(start.getTime() + 61_000));
    const rows = await api.ownerRows(
      "SELECT status, attempts FROM webhook_delivery WHERE endpoint_id = $1",
      [endpoint["id"]],
    );
    expect(rows[0]).toMatchObject({ status: "delivered", attempts: 2 });
  });

  it("sends nothing to a disabled endpoint and nothing across organizations", async () => {
    const a = await workspace(api);
    const b = await workspace(api);
    const off = await a.register(`${receiverUrl}/off`);
    const other = await b.register(`${receiverUrl}/other`);
    expect(
      (await api.call(`/v1/webhooks/${String(off["id"])}/disable`, { ...a.as, json: {} })).status,
    ).toBe(200);
    calls.length = 0;
    answer = 200;
    await a.transport();
    await dispatch(api);
    expect(calls.filter((call) => call.path === "/off")).toHaveLength(0);
    expect(calls.filter((call) => call.path === "/other")).toHaveLength(0);
    const own = await api.ownerRows(
      "SELECT count(*)::int AS n FROM webhook_delivery WHERE endpoint_id = $1",
      [other["id"]],
    );
    expect(own[0]?.["n"]).toBe(0);
  });

  it("includes the partner's own id for a transport that has one", async () => {
    const w = await workspace(api);
    await w.register(`${receiverUrl}/ext`);
    const transportId = await w.transport();
    const apiKey = await body(
      await api.call("/v1/api-keys", {
        ...w.as,
        json: { name: "ERP", scopes: ["transport:write"] },
      }),
    );
    await api.asOwner(
      "INSERT INTO external_ref (organization_id, api_key_id, entity_type, external_id, internal_id, request_hash) VALUES ($1, $2, 'transport', 'SAP-42', $3, 'h')",
      [w.organizationId, apiKey["id"], transportId],
    );
    calls.length = 0;
    answer = 200;
    await w.post(`/v1/transports/${transportId}/status`, { status: "planned" });
    await dispatch(api);
    const planned = calls
      .filter((c) => c.path === "/ext")
      .map((c) => JSON.parse(c.body) as { data: Json })
      .find((event) => event.data["toStatus"] === "planned");
    expect(planned?.data["externalId"]).toBe("SAP-42");
  });
});

describe("the address check", () => {
  it("refuses a private target when private hosts are not allowed", async () => {
    expect(await postOnce("http://localhost:1/x", "{}", {}, { allowPrivate: false })).toEqual({
      error: "blocked_address",
    });
    expect(
      await postOnce("http://169.254.169.254/latest", "{}", {}, { allowPrivate: false }),
    ).toEqual({ error: "blocked_address" });
    expect(await postOnce("http://[::1]:1/x", "{}", {}, { allowPrivate: false })).toEqual({
      error: "blocked_address",
    });
  });
});
