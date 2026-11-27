import { describe, expect, it, vi } from "vitest";
import { makeDeps } from "../testing/helpers";
import { importTransports, MAX_CSV_CHARACTERS } from "./transport-import";

const ORG = "11111111-1111-4111-8111-111111111111";

const report = {
  status: "preview",
  fileProblems: [],
  rows: [{ line: 2, problems: [] }],
  summary: { total: 1, valid: 1, failed: 0 },
  created: [],
};

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

async function sessionFor(deps: ReturnType<typeof makeDeps>) {
  return deps.store.createSession(
    {
      accessToken: "access-1",
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
      subject: "s",
      activeOrganizationId: ORG,
    },
    60,
  );
}

describe("importTransports", () => {
  it("sends the CSV and the dry-run flag and returns the report", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = respond(200, report);
    expect(await importTransports(sessionId, "a,b\n1,2", true, deps, fetchFn)).toEqual({
      status: "ok",
      report,
    });
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:4000/v1/transports/import");
    expect(JSON.parse(init?.body as string)).toEqual({ csv: "a,b\n1,2", dryRun: true });
    expect((init?.headers as Record<string, string>)["x-organization-id"]).toBe(ORG);
  });

  it("sends dryRun false for the real import", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = respond(200, { ...report, status: "imported", created: ["LL-000001"] });
    await importTransports(sessionId, "x", false, deps, fetchFn);
    expect(JSON.parse(vi.mocked(fetchFn).mock.calls[0]?.[1]?.body as string)).toMatchObject({
      dryRun: false,
    });
  });

  it("does not call the API for a file that is too large", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = respond(200, report);
    const result = await importTransports(
      sessionId,
      "x".repeat(MAX_CSV_CHARACTERS + 1),
      true,
      deps,
      fetchFn,
    );
    expect(result).toEqual({ status: "too_large" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    [403, "forbidden"],
    [401, "signed_out"],
    [400, "too_large"],
    [500, "unavailable"],
  ])("maps HTTP %i to %s", async (status, expected) => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const result = await importTransports(sessionId, "x", true, deps, respond(status, {}));
    expect(result.status).toBe(expected);
  });

  it("is signed out without a session", async () => {
    const result = await importTransports(undefined, "x", true, makeDeps(), respond(200, report));
    expect(result.status).toBe("signed_out");
  });
});
