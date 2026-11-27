import { describe, expect, it, vi } from "vitest";
import { makeDeps } from "../testing/helpers";
import { inputFromForm, isMasterDataKey, MASTER_DATA } from "./master-data";
import { saveRecord, setArchived } from "./master-data-actions";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

async function sessionFor(deps: ReturnType<typeof makeDeps>, withOrganization = true) {
  return deps.store.createSession(
    {
      accessToken: "access-1",
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
      subject: "s",
      ...(withOrganization ? { activeOrganizationId: ORG } : {}),
    },
    60,
  );
}

describe("master data configuration", () => {
  it("only knows its three kinds", () => {
    expect(isMasterDataKey("customers")).toBe(true);
    expect(isMasterDataKey("locations")).toBe(true);
    expect(isMasterDataKey("members")).toBe(false);
    expect(isMasterDataKey("__proto__")).toBe(false);
    expect(isMasterDataKey("toString")).toBe(false);
  });

  it("names the permissions of every kind in the form resource:action", () => {
    for (const config of Object.values(MASTER_DATA)) {
      expect(config.read).toMatch(/^[a-z]+:read$/);
      expect(config.manage).toMatch(/^[a-z]+:manage$/);
      expect(config.fields.some((field) => field.name === "name")).toBe(true);
      for (const column of config.columns) {
        expect(config.fields.some((field) => field.name === column.key)).toBe(true);
      }
    }
  });

  it("builds the API input from a form: trims, keeps blanks as empty strings, ignores other fields", () => {
    const form = new FormData();
    form.set("name", "  Acme Foods  ");
    form.set("contactEmail", "");
    form.set("organizationId", "attacker");
    expect(inputFromForm(MASTER_DATA.customers, form)).toEqual({
      name: "Acme Foods",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      notes: "",
    });
  });
});

describe("saveRecord", () => {
  const input = { name: "Acme" };

  it("creates with POST for the active organization and returns the new id", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = respond(201, { id: ID, name: "Acme" });
    expect(await saveRecord(sessionId, "customers", undefined, input, deps, fetchFn)).toEqual({
      status: "saved",
      id: ID,
    });
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:4000/v1/customers");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-organization-id"]).toBe(ORG);
    expect(headers["authorization"]).toBe("Bearer access-1");
  });

  it("changes with PATCH on the record's path", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = respond(200, { id: ID });
    await saveRecord(sessionId, "carriers", ID, input, deps, fetchFn);
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe(`http://127.0.0.1:4000/v1/carriers/${ID}`);
    expect(init?.method).toBe("PATCH");
  });

  it("hands field errors back for the form", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = respond(400, {
      code: "validation_failed",
      errors: [
        { path: "name", message: "too short", code: "too_small" },
        { path: "name", message: "second message", code: "x" },
        { path: "contactEmail", message: "invalid", code: "invalid_format" },
      ],
    });
    expect(await saveRecord(sessionId, "customers", undefined, input, deps, fetchFn)).toEqual({
      status: "invalid",
      fieldErrors: { name: "too short", contactEmail: "invalid" },
    });
  });

  it.each([
    [409, { code: "name_taken" }, "name_taken"],
    [403, { code: "permission_denied" }, "forbidden"],
    [404, {}, "not_found"],
    [401, {}, "signed_out"],
    [500, {}, "unavailable"],
  ])("maps HTTP %i %j to %s", async (status, body, expected) => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const result = await saveRecord(sessionId, "locations", ID, input, deps, respond(status, body));
    expect(result.status).toBe(expected);
  });

  it("does nothing without a session or without an active organization", async () => {
    const deps = makeDeps();
    const fetchFn = respond(201, { id: ID });
    expect((await saveRecord(undefined, "customers", undefined, input, deps, fetchFn)).status).toBe(
      "signed_out",
    );
    const noOrg = await sessionFor(deps, false);
    expect((await saveRecord(noOrg, "customers", undefined, input, deps, fetchFn)).status).toBe(
      "forbidden",
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("setArchived", () => {
  it("sends the archived flag", async () => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    const fetchFn = respond(200, { id: ID });
    expect(await setArchived(sessionId, "customers", ID, true, deps, fetchFn)).toBe("done");
    const [, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ archived: true });
  });

  it.each([
    [404, "not_found"],
    [403, "forbidden"],
    [401, "signed_out"],
    [500, "unavailable"],
  ])("maps HTTP %i to %s", async (status, expected) => {
    const deps = makeDeps();
    const sessionId = await sessionFor(deps);
    expect(await setArchived(sessionId, "carriers", ID, false, deps, respond(status, {}))).toBe(
      expected,
    );
  });
});
