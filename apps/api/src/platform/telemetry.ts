import type { NextFunction, Request, RequestHandler, Response } from "express";
import { context, SpanKind, SpanStatusCode, trace, type Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { TenantRequest } from "./request-context.ts";

export type TracesExporter = "none" | "console" | "otlp";

export interface TelemetryOptions {
  exporter: TracesExporter;
  serviceName: string;
  /** Tests pass an in-memory exporter. It replaces the choice above. */
  spanExporter?: SpanExporter;
}

export interface Telemetry {
  /** Sends what is still buffered. Call before the process exits. */
  shutdown: () => Promise<void>;
}

const TRACER_NAME = "loadlane-api";

function processorFor(options: TelemetryOptions): SpanProcessor | undefined {
  if (options.spanExporter) return new SimpleSpanProcessor(options.spanExporter);
  // The OTLP exporter reads its endpoint from the standard OTEL_EXPORTER_OTLP_* variables.
  if (options.exporter === "otlp") return new BatchSpanProcessor(new OTLPTraceExporter());
  if (options.exporter === "console") return new SimpleSpanProcessor(new ConsoleSpanExporter());
  return undefined;
}

/**
 * Turns tracing on. With exporter "none" (the default) nothing is registered, the tracer stays a
 * no-op and requests pay no cost. Spans never carry tokens, headers, query values or IP addresses.
 */
export function startTelemetry(options: TelemetryOptions): Telemetry {
  const processor = processorFor(options);
  if (!processor) return { shutdown: () => Promise.resolve() };
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ "service.name": options.serviceName }),
    spanProcessors: [processor],
  });
  provider.register();
  return { shutdown: () => provider.shutdown() };
}

/** Trace and span id of the request being handled, for log lines. Empty when tracing is off. */
export function traceFields(): { traceId?: string; spanId?: string } {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const { traceId, spanId } = span.spanContext();
  return { traceId, spanId };
}

/**
 * One server span per request. It is named after the route template (never the concrete URL), so
 * one route is one span name. A trace id sent by the caller is not adopted: we do not trust it.
 */
export function requestTracing(tracer: Tracer = trace.getTracer(TRACER_NAME)): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const span = tracer.startSpan(request.method, {
      kind: SpanKind.SERVER,
      attributes: { "http.request.method": request.method },
    });
    response.once("close", () => {
      const route = (request.route as { path?: string } | undefined)?.path;
      const { auth, tenant } = request as TenantRequest;
      span.updateName(route ? `${request.method} ${request.baseUrl}${route}` : request.method);
      if (route) span.setAttribute("http.route", `${request.baseUrl}${route}`);
      span.setAttribute("http.response.status_code", response.statusCode);
      if (auth) span.setAttribute("loadlane.user_id", auth.user.id);
      if (tenant) span.setAttribute("loadlane.organization_id", tenant.organizationId);
      if (response.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    });
    context.with(trace.setSpan(context.active(), span), next);
  };
}
