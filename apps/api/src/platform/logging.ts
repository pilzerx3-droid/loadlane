import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { LoggerModule } from "nestjs-pino";
import pino, { type DestinationStream } from "pino";
import type { TenantRequest } from "./request-context.ts";

export interface LogOptions {
  level: string;
  /** Tests capture the log lines here. Default: standard output. */
  stream?: DestinationStream;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Takes a caller's X-Request-Id if it is harmless, otherwise makes a new one. */
export function requestIdFor(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && REQUEST_ID_PATTERN.test(value) ? value : randomUUID();
}

interface SerializedRequest {
  id?: unknown;
  method?: string;
  url?: string;
}

/**
 * One structured JSON line per request: request id, method, path (never the query string), status,
 * duration, and the user and organization once the guards know them. Never logged: tokens, headers,
 * cookies, bodies, query values, IP addresses.
 */
export function loggerModule(options: LogOptions) {
  return LoggerModule.forRoot({
    pinoHttp: {
      level: options.level,
      ...(options.stream ? { stream: options.stream } : {}),
      timestamp: pino.stdTimeFunctions.isoTime,
      genReqId: (request: IncomingMessage, response: ServerResponse) => {
        const id = requestIdFor(request.headers["x-request-id"]);
        response.setHeader("X-Request-Id", id);
        return id;
      },
      customProps: (request: IncomingMessage) => {
        const { auth, tenant } = request as TenantRequest;
        return { userId: auth?.user.id, organizationId: tenant?.organizationId };
      },
      serializers: {
        req: (request: SerializedRequest) => ({
          id: request.id,
          method: request.method,
          path: request.url?.split("?")[0],
        }),
        res: (response: { statusCode?: number }) => ({ statusCode: response.statusCode }),
      },
      redact: { paths: ["req.headers", "res.headers"], remove: true },
      customLogLevel: (_request, response, error) =>
        error || response.statusCode >= 500
          ? "error"
          : response.statusCode >= 400
            ? "warn"
            : "info",
      customSuccessMessage: (request, response) =>
        `${request.method ?? ""} ${(request.url ?? "").split("?")[0] ?? ""} -> ${response.statusCode}`,
      customErrorMessage: (request, response) =>
        `${request.method ?? ""} ${(request.url ?? "").split("?")[0] ?? ""} -> ${response.statusCode}`,
    },
  });
}
