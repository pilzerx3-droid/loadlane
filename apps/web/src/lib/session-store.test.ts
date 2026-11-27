// Integration test against the local Valkey from infra/docker-compose.yml (pnpm infra:up).
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ValkeySessionStore, type SessionData } from "./session-store";

const rootEnvFile = join(import.meta.dirname, "..", "..", "..", "..", ".env");
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const prefix = `ll-test:${randomUUID()}:`;
let redis: Redis;
let store: ValkeySessionStore;

const data: SessionData = {
  accessToken: "access",
  accessTokenExpiresAt: 1_800_000_000,
  refreshToken: "refresh",
  idToken: "id",
  subject: "subject-1",
};

beforeAll(() => {
  redis = new Redis(process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379");
  store = new ValkeySessionStore(redis, prefix);
});

afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  redis.disconnect();
});

describe("sessions", () => {
  it("round-trips with an unguessable id", async () => {
    const id = await store.createSession(data, 60);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await store.getSession(id)).toEqual(data);
  });

  it("leaves optional tokens out instead of storing undefined", async () => {
    const id = await store.createSession(
      { ...data, refreshToken: undefined, idToken: undefined },
      60,
    );
    expect(await store.getSession(id)).toEqual({
      accessToken: "access",
      accessTokenExpiresAt: 1_800_000_000,
      subject: "subject-1",
    });
  });

  it("expires after its lifetime", async () => {
    const id = await store.createSession(data, 1);
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(await store.getSession(id)).toBeUndefined();
  });

  it("keeps the remaining lifetime when updated", async () => {
    const id = await store.createSession(data, 100);
    await store.updateSession(id, { ...data, accessToken: "new" });
    const ttl = await redis.ttl(`${prefix}session:${id}`);
    expect(ttl).toBeGreaterThan(90);
    expect(ttl).toBeLessThanOrEqual(100);
    expect((await store.getSession(id))?.accessToken).toBe("new");
  });

  it("does not bring a destroyed session back by updating it", async () => {
    const id = await store.createSession(data, 60);
    await store.destroySession(id);
    await store.updateSession(id, data);
    expect(await store.getSession(id)).toBeUndefined();
  });

  it("ignores ids that cannot be ours", async () => {
    for (const id of ["", "short", "../etc/passwd", "a".repeat(200), "has space in it for sure"]) {
      expect(await store.getSession(id)).toBeUndefined();
    }
  });

  it("treats damaged records as missing", async () => {
    const id = await store.createSession(data, 60);
    await redis.set(`${prefix}session:${id}`, "{not json", "KEEPTTL");
    expect(await store.getSession(id)).toBeUndefined();
    await redis.set(`${prefix}session:${id}`, JSON.stringify({ accessToken: 1 }), "KEEPTTL");
    expect(await store.getSession(id)).toBeUndefined();
  });
});

describe("pending logins", () => {
  const pending = { state: "s", nonce: "n", codeVerifier: "v" };

  it("can be taken exactly once", async () => {
    const id = await store.savePendingLogin(pending, 60);
    expect(await store.takePendingLogin(id)).toEqual(pending);
    expect(await store.takePendingLogin(id)).toBeUndefined();
  });

  it("expire", async () => {
    const id = await store.savePendingLogin(pending, 1);
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(await store.takePendingLogin(id)).toBeUndefined();
  });

  it("are not mixed up with sessions", async () => {
    const sessionId = await store.createSession(data, 60);
    expect(await store.takePendingLogin(sessionId)).toBeUndefined();
  });
});
