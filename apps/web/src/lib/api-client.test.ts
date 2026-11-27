import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiRequest, fetchMe } from "./api-client";

const org = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme",
  slug: "acme",
  region: "us",
  roles: ["admin"],
  permissions: ["member:read"],
};
const me = {
  user: { id: "u1", email: "ada@example.com", displayName: "Ada" },
  organizations: [org],
};

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

describe("fetchMe", () => {
  it("sends the access token and returns the parsed answer with roles and permissions", async () => {
    const fetchFn = respond(200, me);
    expect(await fetchMe("http://api", "tok", fetchFn)).toEqual({ status: "ok", me });
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe("http://api/v1/me");
    expect((init?.headers as Record<string, string>)["authorization"]).toBe("Bearer tok");
  });

  it.each([
    [401, {}, "unauthorized"],
    [403, { code: "email_not_verified" }, "email_not_verified"],
    [403, { code: "account_disabled" }, "account_disabled"],
    [403, { something: "else" }, "account_disabled"],
    [409, { code: "email_in_use" }, "email_in_use"],
    [503, {}, "unavailable"],
    [500, {}, "unavailable"],
  ])("maps HTTP %i %j to %s", async (status, body, expected) => {
    expect((await fetchMe("http://api", "tok", respond(status, body))).status).toBe(expected);
  });

  it("treats an answer without roles and permissions as unusable", async () => {
    const old = {
      ...me,
      organizations: [{ id: org.id, name: "Acme", slug: "acme", region: "us" }],
    };
    expect((await fetchMe("http://api", "t", respond(200, old))).status).toBe("unavailable");
  });

  it("treats a network failure as unavailable", async () => {
    const failing = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    expect((await fetchMe("http://api", "t", failing)).status).toBe("unavailable");
  });
});

describe("apiRequest", () => {
  const schema = z.object({ ok: z.boolean() });
  const base = { apiUrl: "http://api", accessToken: "tok", schema };

  it("sends the token and the organization header and returns the checked body", async () => {
    const fetchFn = respond(200, { ok: true });
    const result = await apiRequest({ ...base, path: "/v1/x", organizationId: "org-1", fetchFn });
    expect(result).toEqual({ ok: true, data: { ok: true } });
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe("http://api/v1/x");
    expect(init?.method).toBe("GET");
    const headers = init?.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer tok");
    expect(headers["x-organization-id"]).toBe("org-1");
    expect(headers["content-type"]).toBeUndefined();
  });

  it("posts JSON when given a body", async () => {
    const fetchFn = respond(201, { ok: true });
    await apiRequest({ ...base, path: "/v1/x", json: { a: 1 }, fetchFn });
    const [, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"a":1}');
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("returns the problem document's code and field errors for a failure", async () => {
    const errors = [{ path: "name", message: "too short", code: "too_small" }];
    const result = await apiRequest({
      ...base,
      path: "/v1/x",
      fetchFn: respond(400, { code: "validation_failed", errors }),
    });
    expect(result).toEqual({ ok: false, status: 400, code: "validation_failed", errors });
  });

  it("uses a neutral code when the failure has no problem body", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response("oops", { status: 500 })));
    expect(await apiRequest({ ...base, path: "/v1/x", fetchFn })).toEqual({
      ok: false,
      status: 500,
      code: "error",
      errors: [],
    });
  });

  it("rejects a success body of the wrong shape", async () => {
    expect(
      await apiRequest({ ...base, path: "/v1/x", fetchFn: respond(200, { ok: "yes" }) }),
    ).toEqual({
      ok: false,
      status: 502,
      code: "invalid_response",
      errors: [],
    });
  });

  it("reports an unreachable API", async () => {
    const failing = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    expect(await apiRequest({ ...base, path: "/v1/x", fetchFn: failing })).toEqual({
      ok: false,
      status: 0,
      code: "unavailable",
      errors: [],
    });
  });
});
