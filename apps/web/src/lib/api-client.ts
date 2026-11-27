import { z } from "zod";

const meSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), displayName: z.string() }),
  organizations: z.array(
    z.object({ id: z.string(), name: z.string(), slug: z.string(), region: z.enum(["us", "eu"]) }),
  ),
});

export type Me = z.infer<typeof meSchema>;

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
