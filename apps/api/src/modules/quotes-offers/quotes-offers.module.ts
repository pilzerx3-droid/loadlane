import { Module } from "@nestjs/common";
import type pg from "pg";
import { APP_POOL } from "../../platform/tokens.ts";
import { QuoteController } from "./quote.controller.ts";
import { QuoteService } from "./quote-service.ts";
import { QUOTE_SERVICE } from "./tokens.ts";

/** Quotes: offers of a frozen calculation's price to a customer. */
@Module({
  controllers: [QuoteController],
  providers: [
    {
      provide: QUOTE_SERVICE,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) => new QuoteService(pool),
    },
  ],
})
export class QuotesOffersModule {}
