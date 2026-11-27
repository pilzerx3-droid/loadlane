import { Module } from "@nestjs/common";
import type pg from "pg";
import { APP_POOL } from "../../platform/tokens.ts";
import { MembersController } from "./members.controller.ts";
import { MembershipAccess } from "./membership-access.ts";
import { MEMBERSHIP_ACCESS } from "./tokens.ts";

/** Who belongs to an organization and what their roles allow (ADR 0010). */
@Module({
  controllers: [MembersController],
  providers: [
    {
      provide: MEMBERSHIP_ACCESS,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) => new MembershipAccess(pool),
    },
  ],
  exports: [MEMBERSHIP_ACCESS],
})
export class UsersPermissionsModule {}
