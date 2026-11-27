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
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  /** Requests per client address and minute. */
  rateLimitPerMinute: number;
  /** Serve /v1/openapi.json. Defaults to on, except when NODE_ENV is production. */
  openApiEnabled: boolean;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// zod runs refinements even when z.url() already failed, so the refinement must cope with any string.
const issuerSchema = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
}, "must be an https URL (http is only allowed for localhost)");

const envSchema = z.object({
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  APP_DATABASE_URL: z.string().min(1),
  OIDC_ISSUER: issuerSchema,
  OIDC_AUDIENCE: z.string().min(1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1_000_000).default(120),
  OPENAPI_ENABLED: z.enum(["true", "false"]).optional(),
  NODE_ENV: z.string().optional(),
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
    logLevel: values.LOG_LEVEL,
    rateLimitPerMinute: values.RATE_LIMIT_PER_MINUTE,
    openApiEnabled: values.OPENAPI_ENABLED
      ? values.OPENAPI_ENABLED === "true"
      : values.NODE_ENV !== "production",
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
