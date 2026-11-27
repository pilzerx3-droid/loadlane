import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

export interface ApiConfig {
  host: string;
  port: number;
  /** Connection string of the application role (loadlane_app), never the owner. */
  databaseUrl: string;
  /** Issuer exactly as the provider's discovery document states it (no trailing slash added). */
  oidcIssuer: string;
  /** Value that must appear in the access token's `aud` claim, for ZITADEL the project id. */
  oidcAudience: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const issuerSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
}, "must be an https URL (http is only allowed for localhost)");

const envSchema = z.object({
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  APP_DATABASE_URL: z.string().min(1),
  OIDC_ISSUER: issuerSchema,
  OIDC_AUDIENCE: z.string().min(1),
});

/** Validates the environment and returns typed settings. The error lists every problem at once. */
export function loadApiConfig(env: Record<string, string | undefined>): ApiConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid API configuration (see .env.example):\n${problems}`);
  }
  const values = parsed.data;
  return {
    host: values.API_HOST,
    port: values.API_PORT,
    databaseUrl: values.APP_DATABASE_URL,
    oidcIssuer: values.OIDC_ISSUER,
    oidcAudience: values.OIDC_AUDIENCE,
  };
}

/** Loads the repository's .env (searching upwards from the working directory). Never overrides real environment variables. */
export function loadEnvFileIfPresent(startDirectory: string = process.cwd()): void {
  let directory = resolve(startDirectory);
  for (let depth = 0; depth < 5; depth++) {
    const candidate = join(directory, ".env");
    if (existsSync(candidate) && existsSync(join(directory, "pnpm-workspace.yaml"))) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}
