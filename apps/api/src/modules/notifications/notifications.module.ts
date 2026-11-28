import { Module } from "@nestjs/common";
import type pg from "pg";
import type { RuntimeConfig } from "../../config/env.ts";
import type { MailProvider } from "../../platform/mail.ts";
import { API_CONFIG, APP_POOL, MAIL_PROVIDER } from "../../platform/tokens.ts";
import { MailService } from "./mail-service.ts";
import { NotificationsController } from "./notifications.controller.ts";
import { MAIL_SERVICE } from "./tokens.ts";

/** Outgoing e-mail (ADR 0021): the mail service other modules use, and the log of what was sent. */
@Module({
  controllers: [NotificationsController],
  providers: [
    {
      provide: MAIL_SERVICE,
      inject: [APP_POOL, MAIL_PROVIDER, API_CONFIG],
      useFactory: (pool: pg.Pool, provider: MailProvider, config: RuntimeConfig) =>
        new MailService(pool, provider, config.appUrl ?? "http://localhost:3000"),
    },
  ],
  exports: [MAIL_SERVICE],
})
export class NotificationsModule {}
