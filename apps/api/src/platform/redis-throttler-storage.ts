import { ThrottlerStorageService, type ThrottlerStorage } from "@nestjs/throttler";

/** The part of an ioredis client the limiter needs, so tests can pass a fake. */
export interface CounterStore {
  multi(): {
    incr(key: string): unknown;
    pttl(key: string): unknown;
    exec(): Promise<[Error | null, unknown][] | null>;
  };
  pexpire(key: string, milliseconds: number): Promise<unknown>;
}

type Record = Awaited<ReturnType<ThrottlerStorage["increment"]>>;

/**
 * Counts requests in Redis (Valkey) so several API instances share one limit per client address.
 * If the store cannot be reached the limiter does not take the API down: it counts in memory for
 * that instance until the store answers again, and reports each outage once through `onFallback`.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly fallback = new ThrottlerStorageService();
  private down = false;

  constructor(
    private readonly redis: CounterStore,
    private readonly onFallback: (message: string) => void = () => undefined,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<Record> {
    const redisKey = `loadlane:ratelimit:${throttlerName}:${key}`;
    try {
      const result = await this.count(redisKey, ttl);
      if (this.down) {
        this.down = false;
        this.onFallback("Rate limit store is reachable again");
      }
      return {
        totalHits: result.hits,
        timeToExpire: Math.max(1, Math.ceil(result.remainingMs / 1000)),
        isBlocked: result.hits > limit && blockDuration > 0,
        timeToBlockExpire:
          result.hits > limit && blockDuration > 0 ? Math.ceil(blockDuration / 1000) : 0,
      };
    } catch {
      if (!this.down) {
        this.down = true;
        this.onFallback("Rate limit store is unreachable: counting in memory on this instance");
      }
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  private async count(key: string, ttl: number): Promise<{ hits: number; remainingMs: number }> {
    const pipeline = this.redis.multi();
    pipeline.incr(key);
    pipeline.pttl(key);
    const replies = await pipeline.exec();
    if (!replies) throw new Error("the counter pipeline did not run");
    const [incr, pttl] = replies;
    if (!incr || incr[0] || !pttl || pttl[0]) throw new Error("the counter pipeline failed");
    const hits = Number(incr[1]);
    let remainingMs = Number(pttl[1]);
    // A counter with no expiry is new (or a crash left it without one): start its window now.
    if (!(remainingMs > 0)) {
      await this.redis.pexpire(key, ttl);
      remainingMs = ttl;
    }
    return { hits, remainingMs };
  }
}
