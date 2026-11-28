import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule, withDefaults, type AppModuleOptions } from "./app.module.ts";
import { securityHeaders } from "./platform/security-headers.ts";
import { requestTracing } from "./platform/telemetry.ts";
import { buildOpenApiDocument, OpenApiService } from "./platform/openapi.ts";

/** Builds the application the same way for production and for tests. Does not start listening. */
export async function createApp(input: AppModuleOptions): Promise<INestApplication> {
  const options = withDefaults(input);
  const app = await NestFactory.create(AppModule.forRoot(input), { bufferLogs: true });
  // Do not tell the world which framework answers.
  (app.getHttpAdapter().getInstance() as { disable: (setting: string) => void }).disable(
    "x-powered-by",
  );
  app.use(securityHeaders());
  app.use(requestTracing());
  app.useLogger(app.get(Logger));
  if (options.openApiEnabled) app.get(OpenApiService).set(buildOpenApiDocument(app));
  return app;
}
