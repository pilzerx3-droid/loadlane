// A local stand-in for an OIDC provider, used by tests only. It serves a discovery document, a key set
// and a userinfo endpoint on 127.0.0.1 and signs tokens with keys it generates itself.
// This proves our verification logic. It does NOT prove that a real provider (ZITADEL) behaves the
// same way; that needs a run against a live test instance.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { decodeJwt, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

export interface SignOptions {
  subject?: string;
  issuer?: string;
  audience?: string;
  /** Expiry as epoch seconds. Defaults to five minutes from now. */
  expiresAt?: number;
  omit?: ("sub" | "exp")[];
  kid?: string;
  /** Sign with this key instead of the issuer's current key. */
  keyPair?: KeyPair;
  extraClaims?: Record<string, unknown>;
}

export interface FakeIssuer {
  issuer: string;
  audience: string;
  userInfoCalls: number;
  sign(options?: SignOptions): Promise<string>;
  /** A token with header alg "none" and no signature. */
  unsignedToken(subject: string): string;
  /** Replaces the signing key. Tokens signed with the old key stop verifying once the key set is refetched. */
  rotateKeys(): Promise<void>;
  newKeyPair(): Promise<KeyPair>;
  setUserInfo(subject: string, body: Record<string, unknown>): void;
  failUserInfoWith(status: number | undefined): void;
  /** Stops answering, as if the provider were down. */
  down(): Promise<void>;
  up(): Promise<void>;
  close(): Promise<void>;
}

function base64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export async function startFakeIssuer(audience = "test-api"): Promise<FakeIssuer> {
  let keyPair = await generateKeyPair("RS256", { extractable: true });
  let kid = "key-1";
  let keyCounter = 1;
  let publicJwk: JWK = await exportJWK(keyPair.publicKey);
  const userInfoBySubject = new Map<string, Record<string, unknown>>();
  let userInfoStatus: number | undefined;
  let port = 0;
  let issuer = "";

  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };

    if (path === "/.well-known/openid-configuration") {
      return json(200, {
        issuer,
        jwks_uri: `${issuer}/keys`,
        userinfo_endpoint: `${issuer}/userinfo`,
      });
    }
    if (path === "/keys") {
      return json(200, { keys: [{ ...publicJwk, kid, alg: "RS256", use: "sig" }] });
    }
    if (path === "/userinfo") {
      handle.userInfoCalls++;
      if (userInfoStatus) return json(userInfoStatus, { error: "forced" });
      const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
      if (!bearer) return json(401, { error: "missing token" });
      const subject = decodeJwt(bearer).sub ?? "";
      return json(200, userInfoBySubject.get(subject) ?? { sub: subject });
    }
    return json(404, { error: "not found" });
  });

  const listen = (): Promise<void> =>
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        port = (server.address() as AddressInfo).port;
        issuer = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

  const stop = (): Promise<void> =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });

  await listen();

  const handle: FakeIssuer = {
    get issuer() {
      return issuer;
    },
    audience,
    userInfoCalls: 0,
    async sign(options = {}) {
      const now = Math.floor(Date.now() / 1000);
      const jwt = new SignJWT({ ...options.extraClaims })
        .setProtectedHeader({ alg: "RS256", kid: options.kid ?? kid, typ: "at+jwt" })
        .setIssuer(options.issuer ?? issuer)
        .setAudience(options.audience ?? audience)
        .setIssuedAt(now);
      if (!options.omit?.includes("sub")) jwt.setSubject(options.subject ?? "subject-1");
      if (!options.omit?.includes("exp")) jwt.setExpirationTime(options.expiresAt ?? now + 300);
      return jwt.sign((options.keyPair ?? keyPair).privateKey);
    },
    unsignedToken(subject) {
      const now = Math.floor(Date.now() / 1000);
      const header = base64Url({ alg: "none", typ: "JWT" });
      const payload = base64Url({
        iss: issuer,
        aud: audience,
        sub: subject,
        iat: now,
        exp: now + 300,
      });
      return `${header}.${payload}.`;
    },
    async rotateKeys() {
      keyPair = await generateKeyPair("RS256", { extractable: true });
      publicJwk = await exportJWK(keyPair.publicKey);
      kid = `key-${++keyCounter}`;
    },
    newKeyPair: () => generateKeyPair("RS256", { extractable: true }),
    setUserInfo(subject, body) {
      userInfoBySubject.set(subject, body);
    },
    failUserInfoWith(status) {
      userInfoStatus = status;
    },
    down: stop,
    up: listen,
    close: stop,
  };
  return handle;
}
