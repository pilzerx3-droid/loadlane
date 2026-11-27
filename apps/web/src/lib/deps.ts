import { Redis } from "ioredis";
import { loadWebConfig } from "./config";
import type { AuthDeps } from "./auth-routes";
import { OpenIdClientFlow } from "./oidc-flow";
import { ValkeySessionStore } from "./session-store";

const holder = globalThis as unknown as { __loadlaneAuthDeps?: AuthDeps };

/**
 * Server-side singletons (configuration, Valkey connection, OIDC client). Created on first use, not at
 * build time, and kept on globalThis so that hot reloading in development does not open new connections.
 */
export function getAuthDeps(): AuthDeps {
  holder.__loadlaneAuthDeps ??= (() => {
    const config = loadWebConfig(process.env);
    const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
    redis.on("error", (error: Error) => console.error("Valkey connection error:", error.message));
    return {
      config,
      store: new ValkeySessionStore(redis),
      oidc: new OpenIdClientFlow(config),
      log: (message, error) => {
        console.error(message, error instanceof Error ? error.message : (error ?? ""));
      },
    };
  })();
  return holder.__loadlaneAuthDeps;
}
