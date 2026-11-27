import { CustomersModule } from "./customers/index.ts";
import { CarriersModule } from "./carriers/index.ts";
import { DriversModule } from "./drivers/index.ts";
import { VehiclesModule } from "./vehicles/index.ts";
import { TransportOrdersModule } from "./transport-orders/index.ts";
import { DocumentsModule } from "./documents/index.ts";
import { AuditLogsModule } from "./audit-logs/index.ts";
import { TrackingModule } from "./tracking/index.ts";
import { DriverLinkModule } from "./driver-link/index.ts";
import { MapsRoutingModule } from "./maps-routing/index.ts";
import { EtaEngineModule } from "./eta-engine/index.ts";
import { AlertsModule } from "./alerts/index.ts";
import { NotificationsModule } from "./notifications/index.ts";
import { FreightCalculatorModule } from "./freight-calculator/index.ts";
import { PricingTariffsModule } from "./pricing-tariffs/index.ts";
import { QuotesOffersModule } from "./quotes-offers/index.ts";
import { SpotFreightModule } from "./spot-freight/index.ts";
import { IntegrationsModule } from "./integrations/index.ts";
import { ReportingModule } from "./reporting/index.ts";

/**
 * Modules of the masterprompt that have no code yet. They are registered so that the structure exists
 * from the start; each one gets its content in the phase named in its module file.
 */
export const PLANNED_MODULES = [
  CustomersModule,
  CarriersModule,
  DriversModule,
  VehiclesModule,
  TransportOrdersModule,
  DocumentsModule,
  AuditLogsModule,
  TrackingModule,
  DriverLinkModule,
  MapsRoutingModule,
  EtaEngineModule,
  AlertsModule,
  NotificationsModule,
  FreightCalculatorModule,
  PricingTariffsModule,
  QuotesOffersModule,
  SpotFreightModule,
  IntegrationsModule,
  ReportingModule,
];
