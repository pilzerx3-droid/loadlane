// Tests of the shared rate limit store: counting, windows, the fallback when the store is down, and
// one run against a real Valkey (needs REDIS_URL, as in CI and the local stack).
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { loadEnvFileIfPresent } from "../config/env.ts";
import { RedisThrottlerStorage, type CounterStore } from "./redis-throttler-storage.ts";

loadEnvFileIfPresent();

/** A tiny in-memory stand-in for the commands the limiter uses. */
class FakeStore implements CounterStore {
  values = new Map<string, number>();
  expires = new Map<string, number>();
  fail = false;
  now = 0;

  multi() {
    const queue: (() => unknown)[] = [];
    const { values, expires } = this;
    const failing = () => this.fail;
    const now = () => this.now;
    const pipeline = {
      incr: (key: string) => {
        queue.push(() => {
          values.set(key, (values.get(key) ?? 0) + 1);
          return values.get(key);
        });
        return pipeline;
      },
      pttl: (key: string) => {
        queue.push(() => {
          const at = expires.get(key);
          return at === undefined ? -1 : Math.max(1, at - now());
        });
        return pipeline;
      },
      exec: (): Promise<[Error | null, unknown][] | null> => {
        if (failing()) return Promise.reject(new Error("connection refused"));
        return Promise.resolve(queue.map((step) => [null, step()] as [Error | null, unknown]));
      },
    };
    return pipeline;
  }

  pexpire(key: string, milliseconds: number): Promise<unknown> {
    this.expires.set(key, this.now + milliseconds);
    return Promise.resolve(1);
  }
}

describe("RedisThrottlerStorage with a fake store", () => {
  it("counts hits per key and starts the window on the first hit", async () => {
    const store = new FakeStore();
    const storage = new RedisThrottlerStorage(store);
    const first = await storage.increment("1.2.3.4", 60_000, 3, 0, "default");
    expect(first).toMatchObject({ totalHits: 1, timeToExpire: 60, isBlocked: false });
    expect((await storage.increment("1.2.3.4", 60_000, 3, 0, "default")).totalHits).toBe(2);
    expect((await storage.increment("5.6.7.8", 60_000, 3, 0, "default")).totalHits).toBe(1);
    expect(store.expires.size).toBe(2); // each key got its own window once
  });

  it("repairs a counter that has no expiry (for example after a crash between two commands)", async () => {
    const store = new FakeStore();
    store.values.set("loadlane:ratelimit:default:x", 5);
    const storage = new RedisThrottlerStorage(store);
    const record = await storage.increment("x", 30_000, 10, 0, "default");
    expect(record).toMatchObject({ totalHits: 6, timeToExpire: 30 });
    expect(store.expires.get("loadlane:ratelimit:default:x")).toBe(30_000);
  });

  it("reports a block only when a block duration is configured and the limit is exceeded", async () => {
    const storage = new RedisThrottlerStorage(new FakeStore());
    await storage.increment("k", 60_000, 1, 0, "default");
    const over = await storage.increment("k", 60_000, 1, 0, "default");
    expect(over).toMatchObject({ totalHits: 2, isBlocked: false });
    const blocking = new RedisThrottlerStorage(new FakeStore());
    await blocking.increment("k", 60_000, 1, 5_000, "default");
    expect(await blocking.increment("k", 60_000, 1, 5_000, "default")).toMatchObject({
      isBlocked: true,
      timeToBlockExpire: 5,
    });
  });

  it("keeps limiting in memory when the store is down, and says so once", async () => {
    const store = new FakeStore();
    const messages: string[] = [];
    const storage = new RedisThrottlerStorage(store, (message) => messages.push(message));
    store.fail = true;
    expect((await storage.increment("k", 60_000, 3, 0, "default")).totalHits).toBe(1);
    expect((await storage.increment("k", 60_000, 3, 0, "default")).totalHits).toBe(2);
    expect(messages).toEqual([
      "Rate limit store is unreachable: counting in memory on this instance",
    ]);
    store.fail = false;
    expect((await storage.increment("k", 60_000, 3, 0, "default")).totalHits).toBe(1);
    expect(messages.at(-1)).toBe("Rate limit store is reachable again");
  });
});

const url = process.env["REDIS_URL"];

describe.skipIf(!url)("RedisThrottlerStorage against a real Valkey", () => {
  const redis = new Redis(url ?? "redis://127.0.0.1:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  afterAll(() => {
    redis.disconnect();
  });

  it("is shared between two storages (two API instances) and expires", async () => {
    const instanceA = new RedisThrottlerStorage(redis);
    const instanceB = new RedisThrottlerStorage(redis);
    const key = `test-${randomUUID()}`;
    expect((await instanceA.increment(key, 1_500, 5, 0, "test")).totalHits).toBe(1);
    expect((await instanceB.increment(key, 1_500, 5, 0, "test")).totalHits).toBe(2);
    expect((await instanceA.increment(key, 1_500, 5, 0, "test")).totalHits).toBe(3);
    const ttl = await redis.pttl(`loadlane:ratelimit:test:${key}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1_500);
    await new Promise((resolve) => setTimeout(resolve, 1_700));
    expect((await instanceB.increment(key, 1_500, 5, 0, "test")).totalHits).toBe(1);
  });

  it("counts parallel requests without losing any", async () => {
    const storage = new RedisThrottlerStorage(redis);
    const key = `parallel-${randomUUID()}`;
    const records = await Promise.all(
      Array.from({ length: 25 }, () => storage.increment(key, 10_000, 100, 0, "test")),
    );
    expect(records.map((r) => r.totalHits).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
  });
});
