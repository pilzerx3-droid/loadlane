// End-to-end tests of the API foundation (ADR 0011): error format, validation and paging, request ids,
// structured logs, the OpenAPI document and rate limiting. Real app, real database, fake issuer.
import { randomUUID } from "node:crypto";
import { DiscoveryService, Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "../testing/harness.ts";
import { discoverRoutes } from "./routes.ts";

const logLines: string[] = [];
const logStream = { write: (line: string) => void logLines.push(line) };

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi({ log: { level: "info", stream: logStream } });
});

afterAll(async () => {
  await api.close();
});

type Json = Record<string, unknown>;

async function json(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

/** Parsed request log lines (the ones that describe a finished request). */
function requestLogs(): Json[] {
  return logLines
    .map((line) => JSON.parse(line) as Json)
    .filter((entry) => typeof entry["req"] === "object" && entry["req"] !== null);
}

/** The line written when the request finished. Other lines of the same request (for example a warning from a guard) carry the request id too. */
function logFor(requestId: string): Json | undefined {
  return requestLogs().find(
    (entry) => (entry["req"] as Json)["id"] === requestId && typeof entry["res"] === "object",
  );
}

async function adminOfNewOrganization(extraMembers = 0) {
  const admin = await api.person("admin");
  const others = await Promise.all(Array.from({ length: extraMembers }, () => api.person("other")));
  const organizationId = await api.seedOrganization({
    creatorUserId: admin.id,
    members: [
      { userId: admin.id, roles: ["admin"] },
      ...others.map((person) => ({ userId: person.id, roles: ["sales"] })),
    ],
  });
  return { admin, others, organizationId };
}

describe("error format", () => {
  it("answers an unknown route with a 404 problem that carries the request id", async () => {
    const response = await api.call("/v1/nothing-here");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const problem = await json(response);
    expect(problem).toMatchObject({
      type: "urn:loadlane:problem:not_found",
      title: "Not Found",
      status: 404,
      code: "not_found",
      instance: "/v1/nothing-here",
    });
    expect(problem["requestId"]).toBe(response.headers.get("x-request-id"));
  });

  it("answers a missing token with 401, a challenge and no reason", async () => {
    const response = await api.call("/v1/me");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await json(response)).toMatchObject({ code: "unauthorized", status: 401 });
  });

  it("answers a missing permission with 403 permission_denied", async () => {
    const carrier = await api.person("carrier");
    const organizationId = await api.seedOrganization({
      creatorUserId: carrier.id,
      members: [{ userId: carrier.id, roles: ["carrier_user"] }],
    });
    const response = await api.call("/v1/members", { token: carrier.token, organizationId });
    expect(response.status).toBe(403);
    expect(await json(response)).toMatchObject({
      type: "urn:loadlane:problem:permission_denied",
      code: "permission_denied",
    });
  });

  it("answers a second sign-in identity with a known e-mail address with 409", async () => {
    const owner = await api.person("owner");
    const subject = `intruder-${randomUUID()}`;
    api.issuer.setUserInfo(subject, { sub: subject, email: owner.email, email_verified: true });
    const response = await api.call("/v1/me", { token: await api.issuer.sign({ subject }) });
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({ code: "email_in_use" });
  });

  it("answers 503 provider_unavailable when a new person cannot be checked", async () => {
    const subject = `late-${randomUUID()}`;
    api.issuer.setUserInfo(subject, {
      sub: subject,
      email: `${subject}@example.com`,
      email_verified: true,
    });
    const token = await api.issuer.sign({ subject });
    await api.issuer.down();
    try {
      const response = await api.call("/v1/me", { token });
      expect(response.status).toBe(503);
      expect(await json(response)).toMatchObject({ code: "provider_unavailable" });
    } finally {
      await api.issuer.up();
    }
  });
});

describe("validation and paging of GET /v1/members", () => {
  it("returns a default page with the total", async () => {
    const { admin, organizationId } = await adminOfNewOrganization(2);
    const response = await api.call("/v1/members", { token: admin.token, organizationId });
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body["page"]).toEqual({ limit: 50, offset: 0, total: 3 });
    expect((body["members"] as unknown[]).length).toBe(3);
  });

  it("returns slices in a stable order and counts every membership as total", async () => {
    const { admin, others, organizationId } = await adminOfNewOrganization(4);
    const everyone = [admin, ...others].map((person) => person.email).sort();

    const first = await json(
      await api.call("/v1/members?limit=2&offset=0", { token: admin.token, organizationId }),
    );
    const second = await json(
      await api.call("/v1/members?limit=2&offset=2", { token: admin.token, organizationId }),
    );
    const last = await json(
      await api.call("/v1/members?limit=2&offset=4", { token: admin.token, organizationId }),
    );

    const emails = (body: Json) =>
      (body["members"] as { email: string }[]).map((member) => member.email);
    expect([...emails(first), ...emails(second), ...emails(last)]).toEqual(everyone);
    expect(first["page"]).toEqual({ limit: 2, offset: 0, total: 5 });
    expect(emails(last)).toHaveLength(1);
  });

  it("beyond the end returns an empty list", async () => {
    const { admin, organizationId } = await adminOfNewOrganization();
    const body = await json(
      await api.call("/v1/members?offset=100", { token: admin.token, organizationId }),
    );
    expect(body["members"]).toEqual([]);
    expect(body["page"]).toMatchObject({ offset: 100, total: 1 });
  });

  it("ignores query parameters it does not know", async () => {
    const { admin, organizationId } = await adminOfNewOrganization();
    const response = await api.call("/v1/members?cache-buster=1", {
      token: admin.token,
      organizationId,
    });
    expect(response.status).toBe(200);
  });

  it.each([
    ["limit=0", "limit"],
    ["limit=101", "limit"],
    ["limit=abc", "limit"],
    ["limit=1.5", "limit"],
    ["offset=-1", "offset"],
    ["offset=abc", "offset"],
  ])("rejects %s with a field error", async (query, field) => {
    const { admin, organizationId } = await adminOfNewOrganization();
    const response = await api.call(`/v1/members?${query}`, { token: admin.token, organizationId });
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const problem = (await json(response)) as { code: string; errors: { path: string }[] };
    expect(problem.code).toBe("validation_failed");
    expect(problem.errors.map((error) => error.path)).toEqual([field]);
  });
});

describe("request id", () => {
  it("echoes a harmless X-Request-Id from the caller", async () => {
    const response = await api.call("/v1/openapi.json", {
      headers: { "x-request-id": "client-req.42" },
    });
    expect(response.headers.get("x-request-id")).toBe("client-req.42");
  });

  it.each(["has spaces", "x".repeat(200), "a\tb", "<script>"])(
    "replaces the unsuitable X-Request-Id %j with a new one",
    async (value) => {
      const response = await api.call("/v1/openapi.json", { headers: { "x-request-id": value } });
      expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it("creates one when the caller sends none", async () => {
    const response = await api.call("/v1/openapi.json");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("request logging", () => {
  it("writes one JSON line per request with ids, status and duration", async () => {
    const { admin, organizationId } = await adminOfNewOrganization();
    const response = await api.call("/v1/members?limit=5", { token: admin.token, organizationId });
    const entry = logFor(response.headers.get("x-request-id") ?? "");

    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      level: 30,
      req: { method: "GET", path: "/v1/members" },
      res: { statusCode: 200 },
      userId: admin.id,
      organizationId,
    });
    expect(typeof entry?.["responseTime"]).toBe("number");
    expect(entry?.["time"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("logs a rejected request as a warning, without user or organization", async () => {
    const response = await api.call("/v1/members", { token: "not-a-token" });
    const entry = logFor(response.headers.get("x-request-id") ?? "");
    expect(entry).toMatchObject({ level: 40, res: { statusCode: 401 } });
    expect(entry).not.toHaveProperty("userId");
  });

  it("never logs tokens, headers, query values or addresses", async () => {
    const { admin, organizationId } = await adminOfNewOrganization();
    const marker = "query-marker-7f3a9c";
    await api.call(`/v1/members?${marker}=1&limit=5`, {
      token: admin.token,
      organizationId,
      headers: { cookie: "session=cookie-marker-55aa" },
    });

    const everything = logLines.join("\n");
    expect(everything).not.toContain(admin.token);
    expect(everything).not.toContain(marker);
    expect(everything).not.toContain("cookie-marker-55aa");
    expect(everything.toLowerCase()).not.toContain("authorization");
    expect(everything).not.toContain("127.0.0.1");
  });
});

describe("OpenAPI document", () => {
  let document: Json;

  beforeAll(async () => {
    const response = await api.call("/v1/openapi.json");
    expect(response.status).toBe(200);
    document = await json(response);
  });

  type Operation = {
    security?: unknown[];
    parameters?: { name: string; in: string; required?: boolean }[];
    responses?: Record<string, { content?: Record<string, { schema?: Json }> }>;
    [extension: string]: unknown;
  };
  const operation = (path: string, method = "get"): Operation =>
    ((document["paths"] as Record<string, Record<string, Operation>>)[path] ?? {})[
      method
    ] as Operation;

  it("is OpenAPI 3.1 and needs no sign-in", () => {
    expect(document["openapi"]).toMatch(/^3\.1/);
    expect(operation("/v1/openapi.json").security ?? []).toEqual([]);
  });

  it("documents who may call each route", () => {
    expect(operation("/v1/members")["x-permissions"]).toEqual(["member:read"]);
    expect(operation("/v1/organization")["x-permissions"]).toEqual(["organization:read"]);
    expect(operation("/v1/me")["x-permissions"]).toBeUndefined();
    for (const path of ["/v1/members", "/v1/organization", "/v1/me"]) {
      expect(operation(path).security?.length, path).toBeGreaterThan(0);
    }
  });

  it("documents the organization header and the query parameters", () => {
    const members = operation("/v1/members").parameters ?? [];
    expect(members.map((p) => `${p.in}:${p.name}`).sort()).toEqual([
      "header:X-Organization-Id",
      "query:limit",
      "query:offset",
    ]);
    expect(members.find((p) => p.name === "X-Organization-Id")?.required).toBe(true);
    expect((operation("/v1/me").parameters ?? []).length).toBe(0);
  });

  it("documents the response schema and the shared error responses", () => {
    const members = operation("/v1/members");
    expect(members.responses?.["200"]?.content?.["application/json"]?.schema).toMatchObject({
      type: "object",
      properties: { members: { type: "array" }, page: { type: "object" } },
    });
    for (const status of ["400", "401", "403", "429", "500"]) {
      expect(
        members.responses?.[status]?.content?.["application/problem+json"]?.schema,
        status,
      ).toEqual({ $ref: "#/components/schemas/Problem" });
    }
    const problem = (document["components"] as { schemas: Record<string, Json> }).schemas[
      "Problem"
    ];
    expect(Object.keys((problem?.["properties"] as Json) ?? {})).toEqual(
      expect.arrayContaining([
        "type",
        "title",
        "status",
        "detail",
        "instance",
        "code",
        "requestId",
        "errors",
      ]),
    );
  });

  it("lists every route the application has, and every route has an access rule", () => {
    const routes = discoverRoutes(api.app.get(DiscoveryService), api.app.get(Reflector));
    expect(routes.map((route) => route.name).sort()).toEqual([
      "ApiKeyController.create",
      "ApiKeyController.list",
      "ApiKeyController.revoke",
      "AuditController.list",
      "CalculationController.create",
      "CalculationController.duplicate",
      "CalculationController.get",
      "CalculationController.list",
      "CarrierController.create",
      "CarrierController.get",
      "CarrierController.list",
      "CarrierController.update",
      "CustomerController.create",
      "CustomerController.get",
      "CustomerController.list",
      "CustomerController.update",
      "DocumentController.download",
      "DocumentController.list",
      "DocumentController.remove",
      "DocumentController.upload",
      "DriverController.consent",
      "DriverController.job",
      "DriverController.position",
      "DriverController.status",
      "DriverController.upload",
      "DriverController.withdraw",
      "DriverLinkController.create",
      "DriverLinkController.list",
      "DriverLinkController.revoke",
      "HealthController.live",
      "HealthController.ready",
      "IntegrationController.lookups",
      "IntegrationController.transports",
      "LocationController.create",
      "LocationController.get",
      "LocationController.list",
      "LocationController.update",
      "MapsController.geocode",
      "MapsController.mapData",
      "MapsController.setCoordinates",
      "MeController.me",
      "MembersController.list",
      "NotificationsController.list",
      "OpenApiController.document",
      "OrganizationController.create",
      "OrganizationController.get",
      "QuoteController.changeStatus",
      "QuoteController.create",
      "QuoteController.email",
      "QuoteController.get",
      "QuoteController.list",
      "QuoteController.pdf",
      "QuoteController.update",
      "ReportController.commercial",
      "SpotCarrierController.bid",
      "SpotCarrierController.offer",
      "SpotCarrierController.withdraw",
      "SpotController.award",
      "SpotController.cancel",
      "SpotController.create",
      "SpotController.enterBid",
      "SpotController.get",
      "SpotController.invite",
      "SpotController.list",
      "TariffController.addVersion",
      "TariffController.apply",
      "TariffController.archive",
      "TariffController.create",
      "TariffController.get",
      "TariffController.list",
      "TariffController.restore",
      "TrackingController.create",
      "TrackingController.list",
      "TrackingController.revoke",
      "TrackingController.view",
      "TransportController.alerts",
      "TransportController.changeStatus",
      "TransportController.create",
      "TransportController.get",
      "TransportController.importCsv",
      "TransportController.list",
      "TransportController.summary",
      "TransportController.update",
    ]);
    for (const route of routes) {
      expect(route.rule, route.name).toBeDefined();
      expect(
        operation(route.path.replace(/:([A-Za-z]+)/g, "{$1}"), route.httpMethod),
        `${route.httpMethod} ${route.path}`,
      ).toBeDefined();
    }
  });
});

describe("OpenAPI document switched off", () => {
  it("is not served", async () => {
    const off = await startTestApi({ openApiEnabled: false });
    try {
      const response = await off.call("/v1/openapi.json");
      expect(response.status).toBe(404);
      expect(await json(response)).toMatchObject({ code: "not_found" });
    } finally {
      await off.close();
    }
  });
});

describe("rate limit", () => {
  it("limits per client address, counts rejected requests too, and answers with a problem", async () => {
    const limited = await startTestApi({ rateLimit: { limit: 3, windowMs: 60_000 } });
    try {
      // Invalid tokens: if the access check ran first, these would never be counted.
      const statuses: number[] = [];
      for (let i = 0; i < 3; i++)
        statuses.push((await limited.call("/v1/me", { token: "garbage" })).status);
      expect(statuses).toEqual([401, 401, 401]);

      const blocked = await limited.call("/v1/me", { token: "garbage" });
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("content-type")).toContain("application/problem+json");
      expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await json(blocked)).toMatchObject({
        type: "urn:loadlane:problem:rate_limited",
        status: 429,
        code: "rate_limited",
      });

      // Public routes share the limit.
      expect((await limited.call("/v1/openapi.json")).status).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
