import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseEncryptionKey } from "@loadlane/db";
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
  /** Redis (Valkey) URL for a rate limit shared by all API instances. Without it each instance counts alone. */
  rateLimitRedisUrl?: string;
  /** Serve /v1/openapi.json. Defaults to on, except when NODE_ENV is production. */
  openApiEnabled: boolean;
  /** How many organizations one person may create through the API. */
  maxOrganizationsPerUser: number;
  /** Where request traces go: nowhere (default), the console, or an OTLP/HTTP collector. */
  tracesExporter: "none" | "console" | "otlp";
  /** Public address of the web app, used to build links in e-mails. Never has a trailing slash. */
  appUrl: string;
  /** SMTP server for outgoing e-mail (ADR 0021). Left out when MAIL_SMTP_URL is not set; sending then answers 503. */
  mail?: { smtpUrl: string; from: string };
  /** OpenRouteService key for address lookup and routing (ADR 0021). Left out: both answer 503. */
  ors?: { apiKey: string; baseUrl: string };
  /** Key that encrypts webhook signing secrets (ADR 0022). Left out: creating a webhook answers 503. */
  webhookKey?: Buffer;
  /** Development only: allow http and private addresses as webhook targets. */
  webhookAllowPrivate: boolean;
  /** S3-compatible file storage. Left out when S3_ENDPOINT is not set; document uploads then answer 503. */
  s3?: {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  };
}

/** What the modules need at run time. Tests pass only the parts they use. */
export type RuntimeConfig = Pick<ApiConfig, "oidcIssuer" | "oidcAudience"> &
  Partial<
    Pick<ApiConfig, "maxOrganizationsPerUser" | "appUrl" | "webhookKey" | "webhookAllowPrivate">
  >;

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
  RATE_LIMIT_REDIS_URL: z.string().min(1).optional(),
  OPENAPI_ENABLED: z.enum(["true", "false"]).optional(),
  MAX_ORGANIZATIONS_PER_USER: z.coerce.number().int().min(1).max(1000).default(3),
  ORS_API_KEY: z.string().min(10).optional(),
  ORS_BASE_URL: z.url().default("https://api.openrouteservice.org"),
  WEBHOOK_ENCRYPTION_KEY: z.string().optional(),
  WEBHOOK_ALLOW_PRIVATE_HOSTS: z.enum(["true", "false"]).default("false"),
  APP_URL: z.url().default("http://localhost:3000"),
  MAIL_SMTP_URL: z
    .string()
    .refine(
      (value) => /^smtps?:\/\//.test(value) && URL.canParse(value),
      "must be an smtp:// or smtps:// URL",
    )
    .optional(),
  MAIL_FROM: z.string().min(3).optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(3).max(63).default("loadlane-documents"),
  OTEL_TRACES_EXPORTER: z.enum(["none", "console", "otlp"]).default("none"),
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
    maxOrganizationsPerUser: values.MAX_ORGANIZATIONS_PER_USER,
    tracesExporter: values.OTEL_TRACES_EXPORTER,
    ...(values.RATE_LIMIT_REDIS_URL ? { rateLimitRedisUrl: values.RATE_LIMIT_REDIS_URL } : {}),
    appUrl: values.APP_URL.replace(/\/+$/, ""),
    webhookAllowPrivate: values.WEBHOOK_ALLOW_PRIVATE_HOSTS === "true",
    ...(values.WEBHOOK_ENCRYPTION_KEY
      ? { webhookKey: parseEncryptionKey(values.WEBHOOK_ENCRYPTION_KEY) ?? Buffer.alloc(0) }
      : {}),
    ...mailSettings(values),
    ...(values.ORS_API_KEY
      ? { ors: { apiKey: values.ORS_API_KEY, baseUrl: values.ORS_BASE_URL } }
      : {}),
    ...s3Settings(values),
  };
}

/** Mail settings are all or nothing: a server without a sender address is a mistake worth stopping for. */
function mailSettings(values: z.infer<typeof envSchema>): Pick<ApiConfig, "mail"> {
  if (values.MAIL_SMTP_URL === undefined) return {};
  if (values.MAIL_FROM === undefined) {
    throw new Error(
      "Invalid API configuration (see .env.example):\n  MAIL_FROM is required when MAIL_SMTP_URL is set",
    );
  }
  return { mail: { smtpUrl: values.MAIL_SMTP_URL, from: values.MAIL_FROM } };
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

/** Storage settings are all or nothing: an endpoint without keys is a mistake worth stopping for. */
function s3Settings(values: z.infer<typeof envSchema>): Pick<ApiConfig, "s3"> {
  if (values.S3_ENDPOINT === undefined) return {};
  if (values.S3_ACCESS_KEY_ID === undefined || values.S3_SECRET_ACCESS_KEY === undefined) {
    throw new Error(
      "Invalid API configuration (see .env.example):\n  S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when S3_ENDPOINT is set",
    );
  }
  return {
    s3: {
      endpoint: values.S3_ENDPOINT,
      region: values.S3_REGION,
      accessKeyId: values.S3_ACCESS_KEY_ID,
      secretAccessKey: values.S3_SECRET_ACCESS_KEY,
      bucket: values.S3_BUCKET,
    },
  };
}
