import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeIssuer, type FakeIssuer } from "../testing/fake-issuer.ts";
import { OidcDiscovery } from "./oidc-discovery.ts";
import { ProviderUnavailableError } from "./token-verifier.ts";
import { OidcUserInfoClient } from "./userinfo.ts";

let issuer: FakeIssuer;
let client: OidcUserInfoClient;

beforeAll(async () => {
  issuer = await startFakeIssuer();
  client = new OidcUserInfoClient(new OidcDiscovery(issuer.issuer));
});

afterAll(async () => {
  await issuer.close();
});

async function fetchFor(subject: string) {
  return client.fetch(await issuer.sign({ subject }), subject);
}

describe("userinfo", () => {
  it("returns a verified e-mail address and the display name", async () => {
    issuer.setUserInfo("s1", {
      sub: "s1",
      email: "a@example.com",
      email_verified: true,
      name: "Ada",
    });
    expect(await fetchFor("s1")).toEqual({
      email: "a@example.com",
      emailVerified: true,
      name: "Ada",
    });
  });

  it("accepts the string form of email_verified that some providers send", async () => {
    issuer.setUserInfo("s2", { sub: "s2", email: "b@example.com", email_verified: "true" });
    expect((await fetchFor("s2")).emailVerified).toBe(true);
  });

  it("falls back to preferred_username when there is no name", async () => {
    issuer.setUserInfo("s3", {
      sub: "s3",
      email: "c@example.com",
      email_verified: true,
      preferred_username: "cc",
    });
    expect((await fetchFor("s3")).name).toBe("cc");
  });

  it.each([
    ["flag is false", { email: "d@example.com", email_verified: false }],
    ["flag is missing", { email: "d@example.com" }],
    ["flag is an unexpected string", { email: "d@example.com", email_verified: "yes" }],
  ])("does not treat the address as verified when the %s", async (_name, body) => {
    // An unexpected string fails schema validation, which also means "not usable".
    issuer.setUserInfo("s4", { sub: "s4", ...body });
    const result = await fetchFor("s4").catch((error: unknown) => error);
    if (result instanceof Error) expect(result).toBeInstanceOf(ProviderUnavailableError);
    else expect(result).toMatchObject({ emailVerified: false });
  });

  it("returns an empty, unverified result when the provider sends no e-mail address", async () => {
    issuer.setUserInfo("s5", { sub: "s5" });
    expect(await fetchFor("s5")).toEqual({ email: "", emailVerified: false, name: undefined });
  });

  it("rejects a response about a different subject", async () => {
    issuer.setUserInfo("s6", { sub: "someone-else", email: "e@example.com", email_verified: true });
    await expect(fetchFor("s6")).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("reports provider errors as unavailable", async () => {
    issuer.failUserInfoWith(500);
    try {
      await expect(fetchFor("s7")).rejects.toBeInstanceOf(ProviderUnavailableError);
    } finally {
      issuer.failUserInfoWith(undefined);
    }
  });
});
