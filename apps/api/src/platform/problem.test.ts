// The error format (RFC 9457) and Zod validation, without a database.
import "reflect-metadata";
import { BadRequestException, Controller, Get, HttpException, Module, Query } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ProblemFilter, toProblem } from "./problem.ts";
import { ZodPipe } from "./validation.ts";

const context = { instance: "/v1/thing", requestId: "req-1" };

describe("toProblem", () => {
  it("turns an unexpected error into a neutral 500 that reveals nothing", () => {
    const problem = toProblem(new Error("password is hunter2"), context);
    expect(problem).toEqual({
      type: "urn:loadlane:problem:internal_error",
      title: "Internal Server Error",
      status: 500,
      detail: expect.stringContaining("request id") as string,
      instance: "/v1/thing",
      code: "internal_error",
      requestId: "req-1",
    });
    expect(JSON.stringify(problem)).not.toContain("hunter2");
  });

  it("keeps the code an exception brings and builds the type from it", () => {
    const problem = toProblem(
      new HttpException({ code: "short_and_stout", message: "I am a teapot" }, 418),
      context,
    );
    expect(problem).toMatchObject({
      type: "urn:loadlane:problem:short_and_stout",
      title: "I'm a Teapot",
      status: 418,
      code: "short_and_stout",
      detail: "I am a teapot",
    });
  });

  it.each([
    [400, "bad_request"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [429, "rate_limited"],
    [503, "service_unavailable"],
    [418, "error"],
    [507, "server_error"],
  ])("gives HTTP %i the default code %s", (status, code) => {
    expect(toProblem(new HttpException("x", status), context).code).toBe(code);
  });

  it("uses a plain string response as the detail", () => {
    expect(toProblem(new HttpException("plain text", 400), context).detail).toBe("plain text");
  });

  it("joins a list of messages", () => {
    expect(toProblem(new BadRequestException(["a is wrong", "b is wrong"]), context).detail).toBe(
      "a is wrong; b is wrong",
    );
  });

  it("passes field errors through", () => {
    const errors = [{ path: "limit", message: "too small", code: "too_small" }];
    const problem = toProblem(
      new HttpException({ code: "validation_failed", message: "bad", errors }, 400),
      context,
    );
    expect(problem.errors).toEqual(errors);
  });
});

const querySchema = z.object({ n: z.coerce.number().int().min(1).max(10).default(5) });

@Controller("t")
class ProbeController {
  @Get("boom")
  boom(): never {
    throw new Error("password is hunter2");
  }

  @Get("teapot")
  teapot(): never {
    throw new HttpException({ code: "short_and_stout", message: "I am a teapot" }, 418);
  }

  @Get("validate")
  validate(@Query(new ZodPipe(querySchema)) query: z.output<typeof querySchema>) {
    return query;
  }
}

@Module({
  controllers: [ProbeController],
  providers: [{ provide: APP_FILTER, useClass: ProblemFilter }],
})
class ProbeModule {}

describe("ProblemFilter and ZodPipe in a running application", () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const app = await NestFactory.create(ProbeModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    close = () => app.close();
  });

  afterAll(async () => {
    await close();
  });

  it("answers an unexpected error with a problem document and no internals", async () => {
    const response = await fetch(`${baseUrl}/t/boom?token=secret`);
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const text = await response.text();
    expect(text).not.toContain("hunter2");
    expect(JSON.parse(text)).toMatchObject({
      status: 500,
      code: "internal_error",
      instance: "/t/boom",
    });
  });

  it("keeps status and code of a deliberate exception", async () => {
    const response = await fetch(`${baseUrl}/t/teapot`);
    expect(response.status).toBe(418);
    expect(await response.json()).toMatchObject({ code: "short_and_stout", status: 418 });
  });

  it("answers an unknown route with a 404 problem", async () => {
    const response = await fetch(`${baseUrl}/t/nope`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(await response.json()).toMatchObject({ code: "not_found", status: 404 });
  });

  it("converts and defaults valid query values", async () => {
    expect(await (await fetch(`${baseUrl}/t/validate?n=7`)).json()).toEqual({ n: 7 });
    expect(await (await fetch(`${baseUrl}/t/validate`)).json()).toEqual({ n: 5 });
  });

  it.each(["abc", "0", "11", "1.5", ""])(
    "rejects the query value n=%j with field errors",
    async (value) => {
      const response = await fetch(`${baseUrl}/t/validate?n=${value}`);
      expect(response.status).toBe(400);
      const problem = (await response.json()) as { code: string; errors: { path: string }[] };
      expect(problem.code).toBe("validation_failed");
      expect(problem.errors.map((error) => error.path)).toEqual(["n"]);
    },
  );
});
