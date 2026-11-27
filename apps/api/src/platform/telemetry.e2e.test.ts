// Tracing end to end: one span per request, named after the route, free of secrets, linked to log lines.
import { InMemorySpanExporter, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "../testing/harness.ts";
import { startTelemetry, type Telemetry } from "./telemetry.ts";

const exporter = new InMemorySpanExporter();
const logLines: string[] = [];
const logStream = { write: (line: string) => void logLines.push(line) };

let telemetry: Telemetry;
let api: TestApi;

beforeAll(async () => {
  telemetry = startTelemetry({ exporter: "none", serviceName: "test", spanExporter: exporter });
  api = await startTestApi({ log: { level: "info", stream: logStream } });
});

afterAll(async () => {
  await api.close();
  await telemetry.shutdown();
});

/** Waits until the span of a finished request has been exported. */
async function spanNamed(name: string): Promise<ReadableSpan> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const found = exporter.getFinishedSpans().find((span) => span.name === name);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`no span named ${name}`);
}

describe("request spans", () => {
  it("records one server span per request, named after the route and tagged with who and where", async () => {
    const person = await api.person("tracer");
    const organizationId = await api.seedOrganization({
      creatorUserId: person.id,
      members: [{ userId: person.id, roles: ["admin"] }],
    });
    const response = await api.call("/v1/organization", { token: person.token, organizationId });
    expect(response.status).toBe(200);

    const span = await spanNamed("GET /v1/organization");
    expect(span.attributes).toMatchObject({
      "http.request.method": "GET",
      "http.route": "/v1/organization",
      "http.response.status_code": 200,
      "loadlane.user_id": person.id,
      "loadlane.organization_id": organizationId,
    });
    expect(span.status.code).not.toBe(2);
  });

  it("never records query values, the concrete URL or credentials", async () => {
    const person = await api.person("secretive");
    await api.call("/v1/me?secret=hunter2", { token: person.token });
    const span = await spanNamed("GET /v1/me");
    const everything = JSON.stringify(span.attributes) + span.name;
    expect(everything).not.toContain("hunter2");
    expect(everything).not.toContain(person.token);
    expect(Object.keys(span.attributes).some((key) => /url|header|query|address/.test(key))).toBe(
      false,
    );
  });

  it("gives every unknown URL the same span name, so URLs cannot blow up the span names", async () => {
    await api.call("/v1/does-not-exist-12345");
    const span = await spanNamed("GET /{*splat}");
    expect(span.attributes["http.response.status_code"]).toBe(404);
    expect(span.name).not.toContain("12345");
  });

  it("does not adopt a trace id sent by the caller", async () => {
    const sent = "0af7651916cd43dd8448eb211c80319c";
    const person = await api.person("traceparent");
    await api.call("/v1/me", {
      token: person.token,
      headers: { traceparent: `00-${sent}-b7ad6b7169203331-01` },
    });
    const spans = exporter.getFinishedSpans().filter((span) => span.name === "GET /v1/me");
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) expect(span.spanContext().traceId).not.toBe(sent);
  });
});

describe("log correlation", () => {
  it("puts the trace id of the request on its log line", async () => {
    const person = await api.person("logger");
    const response = await api.call("/v1/me", { token: person.token });
    const requestId = response.headers.get("x-request-id");
    await spanNamed("GET /v1/me");
    const line = logLines
      .map((text) => JSON.parse(text) as Record<string, unknown>)
      .find(
        (entry) =>
          typeof entry["res"] === "object" &&
          (entry["req"] as { id?: string } | undefined)?.id === requestId,
      );
    expect(line?.["traceId"]).toMatch(/^[0-9a-f]{32}$/);
    const traceIds = exporter.getFinishedSpans().map((span) => span.spanContext().traceId);
    expect(traceIds).toContain(line?.["traceId"]);
  });
});

describe("startTelemetry", () => {
  it("does nothing when tracing is off", async () => {
    const off = startTelemetry({ exporter: "none", serviceName: "off" });
    await expect(off.shutdown()).resolves.toBeUndefined();
  });
});
