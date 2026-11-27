import "reflect-metadata";
import { createAppPool } from "@loadlane/db";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.ts";
import { loadApiConfig, loadEnvFileIfPresent } from "./config/env.ts";

loadEnvFileIfPresent();
const config = loadApiConfig(process.env);

const pool = createAppPool(config.databaseUrl);
const app = await NestFactory.create(AppModule.forRoot({ config, pool }), {
  logger: ["error", "warn", "log"],
});

const shutdown = async (): Promise<void> => {
  await app.close();
  await pool.end();
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await app.listen(config.port, config.host);
