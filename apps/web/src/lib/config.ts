import { z } from "zod";

export interface WebConfig {
  oidcIssuer: string;
  oidcClientId: string;
  appUrl: URL;
  apiUrl: string;
  redisUrl: string;
  sessionTtlSeconds: number;
  /** Cookies get the Secure attribute (and the __Host- prefix) when the app is served over https. */
  secureCookies: boolean;
  /** Registered at the provider as redirect URI. */
  callbackUrl: URL;
  /** Registered at the provider as post-logout redirect URI. */
  postLogoutUrl: URL;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// zod runs refinements even when z.url() already failed, so the refinement must cope with any string.
const issuerSchema = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
}, "must be an https URL (http is only allowed for localhost)");

const envSchema = z.object({
  OIDC_ISSUER: issuerSchema,
  OIDC_CLIENT_ID: z.string().min(1),
  APP_URL: z.url(),
  API_URL: z.url(),
  REDIS_URL: z.string().min(1),
  // Absolute lifetime of a sign-in session. Default: 8 hours.
  SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(2_592_000).default(28_800),
});

/** Validates the environment and returns typed settings. The error lists every problem at once. */
export function loadWebConfig(env: Record<string, string | undefined>): WebConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid web configuration (see .env.example):\n${problems}`);
  }
  const values = parsed.data;
  const appUrl = new URL(values.APP_URL);
  return {
    oidcIssuer: values.OIDC_ISSUER,
    oidcClientId: values.OIDC_CLIENT_ID,
    appUrl,
    apiUrl: values.API_URL.replace(/\/$/, ""),
    redisUrl: values.REDIS_URL,
    sessionTtlSeconds: values.SESSION_TTL_SECONDS,
    secureCookies: appUrl.protocol === "https:",
    callbackUrl: new URL("/auth/callback", appUrl),
    postLogoutUrl: new URL("/", appUrl),
  };
}
