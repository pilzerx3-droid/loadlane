// Unit tests for access token verification against a local fake issuer (no database needed).
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeIssuer, type FakeIssuer } from "../../testing/fake-issuer.ts";
import { JoseTokenVerifier } from "./jose-token-verifier.ts";
import { OidcDiscovery } from "./oidc-discovery.ts";
import {
  InvalidTokenError,
  ProviderUnavailableError,
  type InvalidTokenReason,
} from "./token-verifier.ts";

let issuer: FakeIssuer;
let verifier: JoseTokenVerifier;

function createVerifier(overrides: { issuer?: string; audience?: string } = {}): JoseTokenVerifier {
  const issuerUrl = overrides.issuer ?? issuer.issuer;
  return new JoseTokenVerifier({
    issuer: issuerUrl,
    audience: overrides.audience ?? issuer.audience,
    discovery: new OidcDiscovery(issuerUrl),
    jwksCooldownMs: 0,
  });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

async function expectInvalid(token: string | Promise<string>, reason: InvalidTokenReason) {
  const error = await rejection(verifier.verify(await token));
  expect(error).toBeInstanceOf(InvalidTokenError);
  expect((error as InvalidTokenError).reason).toBe(reason);
}

beforeAll(async () => {
  issuer = await startFakeIssuer("project-123");
  verifier = createVerifier();
});

afterAll(async () => {
  await issuer.close();
});

describe("a valid token", () => {
  it("returns issuer, subject and expiry", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 600;
    const result = await verifier.verify(await issuer.sign({ subject: "person-1", expiresAt }));
    expect(result).toEqual({
      issuer: issuer.issuer,
      subject: "person-1",
      expiresAt: new Date(expiresAt * 1000),
    });
  });

  it("is accepted within the clock tolerance after expiry", async () => {
    const justExpired = Math.floor(Date.now() / 1000) - 5;
    await expect(
      verifier.verify(await issuer.sign({ expiresAt: justExpired })),
    ).resolves.toBeDefined();
  });
});

describe("rejected tokens", () => {
  it("expired", async () => {
    await expectInvalid(issuer.sign({ expiresAt: Math.floor(Date.now() / 1000) - 120 }), "expired");
  });

  it("wrong audience", async () => {
    await expectInvalid(issuer.sign({ audience: "another-api" }), "bad_audience");
  });

  it("wrong issuer", async () => {
    await expectInvalid(issuer.sign({ issuer: "https://evil.example" }), "bad_issuer");
  });

  it("missing subject", async () => {
    await expectInvalid(issuer.sign({ omit: ["sub"] }), "bad_claims");
  });

  it("missing expiry", async () => {
    await expectInvalid(issuer.sign({ omit: ["exp"] }), "bad_claims");
  });

  it("payload changed after signing", async () => {
    const [header, , signature] = (await issuer.sign({ subject: "victim" })).split(".");
    const forged = Buffer.from(
      JSON.stringify({
        iss: issuer.issuer,
        aud: issuer.audience,
        sub: "admin",
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    ).toString("base64url");
    await expectInvalid(`${header}.${forged}.${signature}`, "bad_signature");
  });

  it("signed by a different key but announcing a known key id", async () => {
    await expectInvalid(issuer.sign({ keyPair: await issuer.newKeyPair() }), "bad_signature");
  });

  it("announcing a key id the provider does not publish", async () => {
    await expectInvalid(issuer.sign({ kid: "no-such-key" }), "unknown_key");
  });

  it("with algorithm none", async () => {
    await expectInvalid(issuer.unsignedToken("person-1"), "unsupported_algorithm");
  });

  it("with an HMAC algorithm (key confusion attack)", async () => {
    const secret = new TextEncoder().encode("a-shared-secret-of-at-least-32-bytes!!");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", kid: "key-1" })
      .setIssuer(issuer.issuer)
      .setAudience(issuer.audience)
      .setSubject("person-1")
      .setExpirationTime("5m")
      .sign(secret);
    await expectInvalid(token, "unsupported_algorithm");
  });

  it.each(["", "not-a-token", "a.b.c", "a.b"])("not a JWT: %j", async (token) => {
    const error = await rejection(verifier.verify(token));
    expect(error).toBeInstanceOf(InvalidTokenError);
    expect((error as InvalidTokenError).reason).toBe("malformed");
  });
});

describe("key rotation", () => {
  it("accepts tokens from a new key after the provider rotates its keys", async () => {
    const fresh = createVerifier();
    await fresh.verify(await issuer.sign());
    await issuer.rotateKeys();
    await expect(fresh.verify(await issuer.sign())).resolves.toBeDefined();
  });
});

describe("provider problems", () => {
  it("reports an unreachable provider as unavailable, then recovers without a restart", async () => {
    const fresh = createVerifier();
    const token = await issuer.sign();
    await issuer.down();
    expect(await rejection(fresh.verify(token))).toBeInstanceOf(ProviderUnavailableError);
    await issuer.up();
    await expect(fresh.verify(await issuer.sign())).resolves.toBeDefined();
  });

  it("refuses a discovery document that names a different issuer", async () => {
    const misconfigured = createVerifier({ issuer: `${issuer.issuer}/` });
    // The configured issuer differs from what the document states.
    const token = await issuer.sign();
    expect(await rejection(misconfigured.verify(token))).toBeInstanceOf(ProviderUnavailableError);
  });
});
