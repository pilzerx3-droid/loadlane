import { Module } from "@nestjs/common";
import type pg from "pg";
import type { RuntimeConfig } from "../../config/env.ts";
import { API_CONFIG, APP_POOL } from "../../platform/tokens.ts";
import { OrganizationCreator } from "./organization-creator.ts";
import { OrganizationController } from "./organization.controller.ts";
import { ORGANIZATION_CREATOR } from "./tokens.ts";

const DEFAULT_MAX_ORGANIZATIONS_PER_USER = 3;

/** The organization (tenant) itself: its settings and its creation. */
@Module({
  controllers: [OrganizationController],
  providers: [
    {
      provide: ORGANIZATION_CREATOR,
      inject: [APP_POOL, API_CONFIG],
      useFactory: (pool: pg.Pool, config: RuntimeConfig) =>
        new OrganizationCreator(
          pool,
          config.maxOrganizationsPerUser ?? DEFAULT_MAX_ORGANIZATIONS_PER_USER,
        ),
    },
  ],
})
export class OrganizationsModule {}
