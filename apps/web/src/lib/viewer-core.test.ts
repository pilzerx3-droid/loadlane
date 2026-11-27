import { describe, expect, it, vi } from "vitest";
import { makeDeps } from "../testing/helpers";
import { pickActiveOrganization, resolveViewer } from "./viewer-core";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

const organization = (id: string, name: string, roles: string[] = ["admin"]) => ({
  id,
  name,
  slug: name.toLowerCase(),
  region: "us" as const,
  roles,
  permissions: roles.includes("admin") ? ["member:read"] : [],
});

function me(organizations: ReturnType<typeof organization>[]) {
  return {
    user: { id: "u1", email: "ada@example.com", displayName: "Ada Lovelace" },
    organizations,
  };
}

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

async function sessionFor(
  deps: ReturnType<typeof makeDeps>,
  activeOrganizationId?: string,
): Promise<string> {
  return deps.store.createSession(
    {
      accessToken: "access-1",
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
      subject: "s",
      ...(activeOrganizationId ? { activeOrganizationId } : {}),
    },
    60,
  );
}

describe("pickActiveOrganization", () => {
  const orgs = [organization(ORG_A, "Alpha"), organization(ORG_B, "Beta")];

  it("keeps the remembered organization while the person still belongs to it", () => {
    expect(pickActiveOrganization(orgs, ORG_B)?.id).toBe(ORG_B);
  });

  it("falls back to the first organization when the remembered one is gone or unknown", () => {
    expect(pickActiveOrganization(orgs, "33333333-3333-4333-8333-333333333333")?.id).toBe(ORG_A);
    expect(pickActiveOrganization(orgs, undefined)?.id).toBe(ORG_A);
  });

  it("returns nothing for a person without organizations", () => {
    expect(pickActiveOrganization([], ORG_A)).toBeUndefined();
  });
});

describe("resolveViewer", () => {
  it("is signed out without a session", async () => {
    expect(await resolveViewer(undefined, makeDeps(), respond(200, me([])))).toEqual({
      kind: "signed_out",
    });
  });

  it("returns the person with their organizations and the active one", async () => {
    const deps = makeDeps();
    const id = await sessionFor(deps, ORG_B);
    const result = await resolveViewer(
      id,
      deps,
      respond(200, me([organization(ORG_A, "Alpha"), organization(ORG_B, "Beta")])),
    );
    expect(result).toMatchObject({
      kind: "ok",
      viewer: { sessionId: id, accessToken: "access-1", active: { id: ORG_B, name: "Beta" } },
    });
    expect(deps.store.sessions.get(id)?.activeOrganizationId).toBe(ORG_B);
  });

  it("chooses the first organization and remembers it when none was chosen yet", async () => {
    const deps = makeDeps();
    const id = await sessionFor(deps);
    const result = await resolveViewer(
      id,
      deps,
      respond(200, me([organization(ORG_A, "Alpha"), organization(ORG_B, "Beta")])),
    );
    expect(result).toMatchObject({ kind: "ok", viewer: { active: { id: ORG_A } } });
    expect(deps.store.sessions.get(id)?.activeOrganizationId).toBe(ORG_A);
  });

  it("drops a remembered organization the person no longer belongs to", async () => {
    const deps = makeDeps();
    const id = await sessionFor(deps, ORG_B);
    const result = await resolveViewer(id, deps, respond(200, me([organization(ORG_A, "Alpha")])));
    expect(result).toMatchObject({ kind: "ok", viewer: { active: { id: ORG_A } } });
    expect(deps.store.sessions.get(id)?.activeOrganizationId).toBe(ORG_A);
  });

  it("has no active organization for a person who belongs to none, and forgets the old choice", async () => {
    const deps = makeDeps();
    const id = await sessionFor(deps, ORG_B);
    const result = await resolveViewer(id, deps, respond(200, me([])));
    expect(result).toMatchObject({ kind: "ok", viewer: { active: undefined, organizations: [] } });
    expect(deps.store.sessions.get(id)).not.toHaveProperty("activeOrganizationId");
  });

  it("signs out and forgets the session when the API rejects the token", async () => {
    const deps = makeDeps();
    const id = await sessionFor(deps);
    expect(await resolveViewer(id, deps, respond(401, {}))).toEqual({ kind: "signed_out" });
    expect(deps.store.sessions.size).toBe(0);
  });

  it.each([
    [403, { code: "email_not_verified" }, "email_not_verified"],
    [403, { code: "account_disabled" }, "account_disabled"],
    [409, { code: "email_in_use" }, "email_in_use"],
    [503, {}, "unavailable"],
  ])(
    "reports HTTP %i %j as the problem %s and keeps the session",
    async (status, body, problem) => {
      const deps = makeDeps();
      const id = await sessionFor(deps);
      expect(await resolveViewer(id, deps, respond(status, body))).toEqual({
        kind: "problem",
        problem,
      });
      expect(deps.store.sessions.size).toBe(1);
    },
  );
});
