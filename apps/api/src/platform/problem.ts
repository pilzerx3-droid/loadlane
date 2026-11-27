import { STATUS_CODES } from "node:http";
import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

/**
 * The one error format of the API: RFC 9457 "Problem Details" (application/problem+json) with our
 * own `code` (stable, for programs) and `requestId` (to find the log line) as extension members.
 */
export const problemSchema = z.object({
  type: z.string().describe("A URN naming the kind of problem, built from `code`"),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().describe("For people. Do not parse it, use `code`."),
  instance: z.string().describe("The request path"),
  code: z.string().describe("Stable machine-readable error code"),
  requestId: z.string(),
  errors: z
    .array(z.object({ path: z.string(), message: z.string(), code: z.string() }))
    .optional()
    .describe("Field errors of a failed validation"),
});

export type Problem = z.infer<typeof problemSchema>;

const DEFAULT_CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  429: "rate_limited",
  503: "service_unavailable",
};

const UNEXPECTED_DETAIL =
  "An unexpected error occurred. Quote the request id when you contact support.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Maps any thrown value to a problem. Unexpected errors become a neutral 500 without internals. */
export function toProblem(
  exception: unknown,
  context: { instance: string; requestId: string },
): Problem {
  if (!(exception instanceof HttpException)) {
    return {
      type: "urn:loadlane:problem:internal_error",
      title: STATUS_CODES[500] ?? "Internal Server Error",
      status: 500,
      detail: UNEXPECTED_DETAIL,
      instance: context.instance,
      code: "internal_error",
      requestId: context.requestId,
    };
  }

  const status = exception.getStatus();
  const response = exception.getResponse();
  const body = isRecord(response) ? response : {};
  const message = typeof response === "string" ? response : body["message"];
  const code =
    typeof body["code"] === "string"
      ? body["code"]
      : (DEFAULT_CODES[status] ?? (status >= 500 ? "server_error" : "error"));
  const errors = Array.isArray(body["errors"]) ? (body["errors"] as Problem["errors"]) : undefined;

  return {
    type: `urn:loadlane:problem:${code}`,
    title: STATUS_CODES[status] ?? "Error",
    status,
    detail: Array.isArray(message)
      ? message.map(String).join("; ")
      : typeof message === "string"
        ? message
        : (STATUS_CODES[status] ?? "Error"),
    instance: context.instance,
    code,
    requestId: context.requestId,
    ...(errors ? { errors } : {}),
  };
}

/** Global filter: every error, expected or not, leaves the API as a problem document. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: unknown }>();
    const response = http.getResponse<Response>();
    if (response.headersSent) return;

    const headerValue = response.getHeader("x-request-id");
    const requestId =
      typeof request.id === "string"
        ? request.id
        : typeof headerValue === "string"
          ? headerValue
          : "unknown";
    const problem = toProblem(exception, {
      instance: request.originalUrl.split("?")[0] ?? request.url,
      requestId,
    });

    if (problem.status >= 500) {
      this.logger.error(
        `Request ${requestId} failed with ${problem.status} ${problem.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    response.status(problem.status).type("application/problem+json").json(problem);
  }
}
