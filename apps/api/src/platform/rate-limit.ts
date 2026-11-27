import { Injectable, type ExecutionContext } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * Limits requests per client address across the whole API. It runs before authentication on purpose,
 * so repeated requests with invalid tokens are limited too. Counters live in memory: right for one
 * instance. Several instances need a shared store (Valkey) first.
 * Behind a proxy, Express must be told to trust it (`trust proxy`), otherwise every client looks alike.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override getTracker(request: Record<string, unknown>): Promise<string> {
    return Promise.resolve(typeof request["ip"] === "string" ? request["ip"] : "unknown");
  }

  /** The library counts per route by default. One counter per client is what protects the API as a whole. */
  protected override generateKey(
    _context: ExecutionContext,
    tracker: string,
    throttlerName: string,
  ): string {
    return `${throttlerName}:${tracker}`;
  }
}
