import { z } from "zod";

/** Field errors of a failed validation, as the API's problem documents carry them. */
export interface FieldError {
  path: string;
  message: string;
  code: string;
}

export const organizationSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  region: z.enum(["us", "eu"]),
  roles: z.array(z.string()),
  /** What the roles allow, for building navigation. The API checks every request again. */
  permissions: z.array(z.string()),
});

const meSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), displayName: z.string() }),
  organizations: z.array(organizationSummarySchema),
});

export type Me = z.infer<typeof meSchema>;
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const organizationDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  region: z.enum(["us", "eu"]),
  distanceUnit: z.enum(["mi", "km"]),
  weightUnit: z.enum(["lb", "kg"]),
  currency: z.string(),
  locale: z.string(),
  timezone: z.string(),
});

export type OrganizationDetail = z.infer<typeof organizationDetailSchema>;

export const membersResponseSchema = z.object({
  members: z.array(
    z.object({
      userId: z.string(),
      email: z.string(),
      displayName: z.string(),
      status: z.enum(["invited", "active", "suspended", "removed"]),
      roles: z.array(z.string()),
    }),
  ),
  page: z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int() }),
});

export type MembersResponse = z.infer<typeof membersResponseSchema>;

export type MeResult =
  | { status: "ok"; me: Me }
  | { status: "unauthorized" }
  | { status: "email_not_verified" }
  | { status: "email_in_use" }
  | { status: "account_disabled" }
  | { status: "unavailable" };

/** Calls GET /v1/me of our API. Answers are mapped by status code; the API's texts are never shown. */
export async function fetchMe(
  apiUrl: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<MeResult> {
  let response: Response;
  try {
    response = await fetchFn(`${apiUrl}/v1/me`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { status: "unavailable" };
  }

  if (response.status === 401) return { status: "unauthorized" };
  if (response.status === 403 || response.status === 409) {
    // The API names the reason in `code`. Anything unexpected is treated as a disabled account.
    const body = (await response.json().catch(() => ({}))) as { code?: unknown };
    if (body.code === "email_not_verified") return { status: "email_not_verified" };
    if (body.code === "email_in_use") return { status: "email_in_use" };
    return { status: "account_disabled" };
  }
  if (!response.ok) return { status: "unavailable" };

  const parsed = meSchema.safeParse(await response.json().catch(() => undefined));
  return parsed.success ? { status: "ok", me: parsed.data } : { status: "unavailable" };
}

export interface ApiFailure {
  ok: false;
  /** HTTP status, 0 when the API could not be reached, 502 when its answer made no sense. */
  status: number;
  /** The problem document's `code`, or `unavailable` / `invalid_response`. */
  code: string;
  errors: FieldError[];
}

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

/**
 * Calls the API with the person's access token and, for organization routes, the organization header.
 * Success bodies are checked against `schema`; failures come back as the problem document's code.
 */
export async function apiRequest<S extends z.ZodType>(options: {
  apiUrl: string;
  accessToken: string;
  path: string;
  schema: S;
  organizationId?: string;
  json?: unknown;
  fetchFn?: typeof fetch;
}): Promise<ApiResult<z.output<S>>> {
  const fetchFn = options.fetchFn ?? fetch;
  const headers: Record<string, string> = {
    authorization: `Bearer ${options.accessToken}`,
    accept: "application/json",
  };
  if (options.organizationId) headers["x-organization-id"] = options.organizationId;
  if (options.json !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetchFn(`${options.apiUrl}${options.path}`, {
      method: options.json === undefined ? "GET" : "POST",
      headers,
      ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { ok: false, status: 0, code: "unavailable", errors: [] };
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: unknown; errors?: unknown };
    return {
      ok: false,
      status: response.status,
      code: typeof body.code === "string" ? body.code : "error",
      errors: Array.isArray(body.errors) ? (body.errors as FieldError[]) : [],
    };
  }

  const parsed = options.schema.safeParse(await response.json().catch(() => undefined));
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, status: 502, code: "invalid_response", errors: [] };
}
