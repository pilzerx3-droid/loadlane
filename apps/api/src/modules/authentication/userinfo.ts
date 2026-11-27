import { z } from "zod";
import type { OidcDiscovery } from "./oidc-discovery.ts";
import { ProviderUnavailableError } from "./token-verifier.ts";

export interface UserInfo {
  email: string;
  emailVerified: boolean;
  name: string | undefined;
}

/** Where the API gets a person's verified e-mail address from. Replaceable in tests. */
export interface UserInfoSource {
  fetch(accessToken: string, expectedSubject: string): Promise<UserInfo>;
}

const responseSchema = z.object({
  sub: z.string(),
  email: z.string().min(3).optional(),
  // OIDC defines a boolean, some providers send the strings "true" or "false".
  email_verified: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
  name: z.string().min(1).optional(),
  preferred_username: z.string().min(1).optional(),
});

/** Reads e-mail and e-mail verification from the standard OIDC userinfo endpoint. */
export class OidcUserInfoClient implements UserInfoSource {
  constructor(
    private readonly discovery: OidcDiscovery,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 5000,
  ) {}

  async fetch(accessToken: string, expectedSubject: string): Promise<UserInfo> {
    const { userinfoEndpoint } = await this.discovery.get();
    if (!userinfoEndpoint) {
      throw new ProviderUnavailableError("The provider does not advertise a userinfo endpoint");
    }

    let body: unknown;
    try {
      const response = await this.fetchFn(userinfoEndpoint, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      body = await response.json();
    } catch (error) {
      throw new ProviderUnavailableError("Could not read the userinfo endpoint", { cause: error });
    }

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new ProviderUnavailableError("The userinfo response is not valid");
    // OIDC Core 5.3.2: the subject must match the one in the token, otherwise the response is unusable.
    if (parsed.data.sub !== expectedSubject) {
      throw new ProviderUnavailableError("The userinfo response belongs to a different subject");
    }
    if (!parsed.data.email) {
      return { email: "", emailVerified: false, name: undefined };
    }
    return {
      email: parsed.data.email,
      emailVerified: parsed.data.email_verified === true || parsed.data.email_verified === "true",
      name: parsed.data.name ?? parsed.data.preferred_username,
    };
  }
}
