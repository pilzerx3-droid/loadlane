import { Module } from "@nestjs/common";
import type pg from "pg";
import { APP_POOL } from "../../platform/tokens.ts";
import {
  TRANSPORT_SERVICE,
  TransportOrdersModule,
  type TransportService,
} from "../transport-orders/index.ts";
import { ApiKeyService } from "./api-key-service.ts";
import { ApiKeyController, IntegrationController } from "./integration.controller.ts";
import { IntegrationService } from "./integration-service.ts";
import { API_KEY_SERVICE, INTEGRATION_SERVICE } from "./tokens.ts";

/** Integrations (ADR 0009): API keys and the API other systems use. Adapters for SAP and others come later. */
@Module({
  imports: [TransportOrdersModule],
  controllers: [ApiKeyController, IntegrationController],
  providers: [
    {
      provide: API_KEY_SERVICE,
      inject: [APP_POOL],
      useFactory: (pool: pg.Pool) => new ApiKeyService(pool),
    },
    {
      provide: INTEGRATION_SERVICE,
      inject: [APP_POOL, TRANSPORT_SERVICE],
      useFactory: (pool: pg.Pool, transports: TransportService) =>
        new IntegrationService(pool, transports),
    },
  ],
})
export class IntegrationsModule {}
