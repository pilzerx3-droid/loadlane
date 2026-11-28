import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import type pg from "pg";
import { Public } from "./access.ts";
import { APP_POOL } from "./tokens.ts";

/**
 * Health checks for the platform that runs the API. They reveal nothing about the system: no
 * versions, no host names, no error details.
 *  - /v1/health: the process is up (liveness).
 *  - /v1/health/ready: the process can reach its database (readiness).
 */
@Controller("v1/health")
export class HealthController {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  @Get()
  @Public()
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  @Public()
  async ready(): Promise<{ status: "ok" }> {
    try {
      await this.pool.query("SELECT 1");
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: "not_ready",
        message: "The service is not ready.",
      });
    }
    return { status: "ok" };
  }
}
