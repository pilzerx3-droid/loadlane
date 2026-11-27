import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import { z } from "zod";

/** A signed-in browser session. It lives on the server only; the browser holds an opaque id. */
export interface SessionData {
  accessToken: string;
  /** Epoch seconds. */
  accessTokenExpiresAt: number;
  refreshToken?: string | undefined;
  idToken?: string | undefined;
  subject: string;
}

/** What has to be remembered between redirecting to the provider and its callback. */
export interface PendingLogin {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface SessionStore {
  createSession(data: SessionData, ttlSeconds: number): Promise<string>;
  getSession(id: string): Promise<SessionData | undefined>;
  /** Replaces the data and keeps the remaining lifetime (the absolute session limit does not slide). */
  updateSession(id: string, data: SessionData): Promise<void>;
  destroySession(id: string): Promise<void>;
  savePendingLogin(pending: PendingLogin, ttlSeconds: number): Promise<string>;
  /** Returns the record and deletes it in one step, so a callback can be used only once. */
  takePendingLogin(id: string): Promise<PendingLogin | undefined>;
}

const sessionSchema = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.number().int(),
  refreshToken: z.string().min(1).optional(),
  idToken: z.string().min(1).optional(),
  subject: z.string().min(1),
});

const pendingSchema = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  codeVerifier: z.string().min(1),
});

const ID_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

function newId(): string {
  return randomBytes(32).toString("base64url");
}

/** Session store on Valkey (Redis compatible). Keys are `<prefix>session:<id>` and `<prefix>login:<id>`. */
export class ValkeySessionStore implements SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "ll:",
  ) {}

  async createSession(data: SessionData, ttlSeconds: number): Promise<string> {
    const id = newId();
    await this.redis.set(this.sessionKey(id), JSON.stringify(data), "EX", ttlSeconds);
    return id;
  }

  async getSession(id: string): Promise<SessionData | undefined> {
    if (!ID_PATTERN.test(id)) return undefined;
    const raw = await this.redis.get(this.sessionKey(id));
    if (!raw) return undefined;
    const parsed = sessionSchema.safeParse(safeJson(raw));
    return parsed.success ? stripUndefined(parsed.data) : undefined;
  }

  async updateSession(id: string, data: SessionData): Promise<void> {
    if (!ID_PATTERN.test(id)) return;
    // XX: only if the session still exists. KEEPTTL: do not extend the absolute lifetime.
    await this.redis.set(this.sessionKey(id), JSON.stringify(data), "KEEPTTL", "XX");
  }

  async destroySession(id: string): Promise<void> {
    if (!ID_PATTERN.test(id)) return;
    await this.redis.del(this.sessionKey(id));
  }

  async savePendingLogin(pending: PendingLogin, ttlSeconds: number): Promise<string> {
    const id = newId();
    await this.redis.set(this.loginKey(id), JSON.stringify(pending), "EX", ttlSeconds);
    return id;
  }

  async takePendingLogin(id: string): Promise<PendingLogin | undefined> {
    if (!ID_PATTERN.test(id)) return undefined;
    const raw = await this.redis.getdel(this.loginKey(id));
    if (!raw) return undefined;
    const parsed = pendingSchema.safeParse(safeJson(raw));
    return parsed.success ? parsed.data : undefined;
  }

  private sessionKey(id: string): string {
    return `${this.prefix}session:${id}`;
  }

  private loginKey(id: string): string {
    return `${this.prefix}login:${id}`;
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** zod leaves optional keys out; this keeps the SessionData shape exact. */
function stripUndefined(data: z.infer<typeof sessionSchema>): SessionData {
  return {
    accessToken: data.accessToken,
    accessTokenExpiresAt: data.accessTokenExpiresAt,
    subject: data.subject,
    ...(data.refreshToken === undefined ? {} : { refreshToken: data.refreshToken }),
    ...(data.idToken === undefined ? {} : { idToken: data.idToken }),
  };
}
