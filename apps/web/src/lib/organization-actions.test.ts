import { describe, expect, it, vi } from "vitest";
import { makeDeps } from "../testing/helpers";
import { createOrganization, switchOrganization } from "./organization-actions";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

const summary = (id: string) => ({
  id,
  name: id.slice(0, 4),
  slug: id.slice(0, 4),
  region: "us",
  roles: ["admin"],
  permissions: ["member:read"],
});

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

async function sessionFor(deps: ReturnType<typeof makeDeps>): Promise<string> {
  return deps.store.createSession(
    {
      accessToken: "access-1",
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
      subject: "s",
    },
    60,
  );
}

const meBody = (...ids: string[]) => ({
  user: { id: "u1", email: "a@example.com", displayName: "Ada" },
  organizations: ids.map(summary),
});

describe("switchOrganization", () => {
  it("makes an organization the active one when the API says the person belongs to it", async () => {
    const deps = makeDeps();
    const id = await sessionFor(deps);
    expect(await switchOrganization(id, ORG_B, deps, respond(200, meBody(ORG_A, ORG_B)))).toBe(
      "switched",
    );
    expect(deps.store.sessions.get(id)?.activeOrganizationId).toBe(ORG_B);
  });

  it("refuses an organization the person does not belong to and changes nothing", async () => {
    const deps = makeDeps();
    const id = await sessionFor(deps);
    expect(await switchOrganization(id, ORG_B, deps, respond(200, meBody(ORG_A)))).toBe(
      "not_a_member",
    );
    expect(deps.store.sessions.get(id)).not.toHaveProperty("activeOrganizationId");
  });

  it("does nothing without a session", async () => {
    const deps = makeDeps();
    expect(await switchOrganization(undefined, ORG_A, deps, respond(200, meBody(ORG_A)))).toBe(
      "signed_out",
    );
  });

  it("reports an unavailable API and keeps the previous choice", async () => {
    const deps = makeDeps();
    const id = await sessionFor(deps);
    expect(await switchOrganization(id, ORG_A, deps, respond(503, {}))).toBe("unavailable");
    expect(deps.store.sessions.get(id)).not.toHaveProperty("activeOrganizationId");
  });

  it("signs out when the API rejects the token", async () => {
    const deps = makeDeps();
    const id = await sessionFor(deps);
    expect(await switchOrganization(id, ORG_A, deps, respond(401, {}))).toBe("signed_out");
  });
});

describe("createOrganization", () => {
  const created = {
    id: ORG_A,
    name: "Acme",
    slug: "acme",
    region: "us",
    distanceUnit: "mi",
    weightUnit: "lb",
    currency: "USD",
    locale: "en-US",
    timezone: "America/Chicago",
  };
  const input = { name: "Acme", timezone: "America/Chicago" };

  it("creates the organization, sends the input to the API and makes it active", async () => {
    const deps = makeDeps();
    const id = await sessionFor(deps);
    const fetchFn = respond(201, created);

    expect(await createOrganization(id, input, deps, fetchFn)).toEqual({
      status: "created",
      organizationId: ORG_A,
    });
    expect(deps.store.sessions.get(id)?.activeOrganizationId).toBe(ORG_A);

    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:4000/v1/organizations");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(input);
    expect((init?.headers as Record<string, string>)["authorization"]).toBe("Bearer access-1");
  });

  it("hands field errors back for the form", async () => {
    const deps = makeDeps();
    const id = await sessionFor(deps);
    const fetchFn = respond(400, {
      code: "validation_failed",
      errors: [
        {
          path: "name",
          message: "Too small: expected string to have >=2 characters",
          code: "too_small",
        },
        { path: "timezone", message: "must be an IANA time zone", code: "custom" },
      ],
    });
    expect(await createOrganization(id, { name: "A", timezone: "x" }, deps, fetchFn)).toEqual({
      status: "invalid",
      fieldErrors: {
        name: "Too small: expected string to have >=2 characters",
        timezone: "must be an IANA time zone",
      },
    });
    expect(deps.store.sessions.get(id)).not.toHaveProperty("activeOrganizationId");
  });

  it.each(["slug_taken", "organization_limit_reached"])("maps the API code %s", async (code) => {
    const deps = makeDeps();
    const id = await sessionFor(deps);
    expect(await createOrganization(id, input, deps, respond(409, { code }))).toEqual({
      status: code,
    });
  });

  it("is signed out without a session or with a rejected token", async () => {
    const deps = makeDeps();
    expect(await createOrganization(undefined, input, deps, respond(201, created))).toEqual({
      status: "signed_out",
    });
    const id = await sessionFor(deps);
    expect(await createOrganization(id, input, deps, respond(401, {}))).toEqual({
      status: "signed_out",
    });
  });

  it("reports anything else as unavailable and logs it", async () => {
    const deps = makeDeps();
    const id = await sessionFor(deps);
    expect(
      await createOrganization(id, input, deps, respond(500, { code: "internal_error" })),
    ).toEqual({
      status: "unavailable",
    });
    expect(deps.log).toHaveBeenCalled();
  });
});
