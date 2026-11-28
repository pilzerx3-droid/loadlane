import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type pg from "pg";
import { withTenant } from "./tenant.ts";

// Outgoing webhooks (ADR 0022): secret handling, signing, retry timing, a delivery that refuses to
// call private network addresses, and the dispatcher the worker runs.

/** The key that encrypts signing secrets at rest: 32 random bytes, base64 (WEBHOOK_ENCRYPTION_KEY). */
export function parseEncryptionKey(value: string | undefined): Buffer | undefined {
  if (!value) return undefined;
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("WEBHOOK_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return key;
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export function encryptSecret(secret: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64")).join(".");
}

export function decryptSecret(stored: string, key: Buffer): string {
  const [iv, tag, body] = stored.split(".").map((part) => Buffer.from(part, "base64"));
  if (!iv || !tag || !body) throw new Error("malformed secret");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/** The header a receiver verifies: HMAC-SHA256 over "<unix seconds>.<raw body>" with the secret. */
export function signPayload(secret: string, body: string, timestampSeconds: number): string {
  const digest = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}

/** Waits before attempt 2, 3, ... The last entry ends the retries: six attempts in about 15 hours. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export function nextRetryDelayMs(attemptsMade: number): number | undefined {
  return RETRY_DELAYS_MS[attemptsMade - 1];
}

/** True for loopback, private, link-local and other addresses a webhook must never reach. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb")
    );
  }
  return true;
}

/** A webhook URL is https (http only where private hosts are allowed, for local development). */
export function webhookUrlProblem(value: string, allowPrivate: boolean): string | undefined {
  if (!URL.canParse(value)) return "not a valid URL";
  const url = new URL(value);
  if (url.username || url.password) return "must not contain a user name or password";
  if (url.protocol === "https:") return undefined;
  if (url.protocol === "http:" && allowPrivate) return undefined;
  return "must be an https URL";
}

export type DeliveryError = "blocked_address" | "timeout" | "connection_failed";

export interface DeliveryOptions {
  allowPrivate: boolean;
  timeoutMs?: number;
}

/**
 * POSTs the body once and returns the HTTP status. Redirects are not followed. The address check runs
 * inside the connection's own DNS lookup, so a host cannot answer "public" to a check and "private"
 * to the connection.
 */
export function postOnce(
  url: string,
  body: string,
  headers: Record<string, string>,
  options: DeliveryOptions,
): Promise<{ statusCode: number } | { error: DeliveryError }> {
  const target = new URL(url);
  const send = target.protocol === "https:" ? httpsRequest : httpRequest;
  // An address written as a number never goes through the DNS lookup below, so it is checked here.
  const literal = target.hostname.replace(/^\[|\]$/g, "");
  if (!options.allowPrivate && isIP(literal) !== 0 && isPrivateAddress(literal)) {
    return Promise.resolve({ error: "blocked_address" });
  }
  return new Promise((resolve) => {
    let blocked = false;
    const request = send(
      target,
      {
        method: "POST",
        headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
        timeout: options.timeoutMs ?? 10_000,
        lookup: (hostname, lookupOptions, callback) => {
          dnsLookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
            if (error) return callback(error, "", 4);
            if (!options.allowPrivate && addresses.some((a) => isPrivateAddress(a.address))) {
              blocked = true;
              return callback(new Error("blocked address"), "", 4);
            }
            const first = addresses[0];
            if (!first) return callback(new Error("no address"), "", 4);
            return callback(null, first.address, first.family);
          });
        },
      },
      (response) => {
        response.resume();
        resolve({ statusCode: response.statusCode ?? 0 });
      },
    );
    request.on("timeout", () => {
      request.destroy();
      resolve({ error: "timeout" });
    });
    request.on("error", () =>
      resolve({ error: blocked ? "blocked_address" : "connection_failed" }),
    );
    request.end(body);
  });
}

export interface DispatchReport {
  attempted: number;
  delivered: number;
  failedForGood: number;
  retryLater: number;
}

interface DueRow {
  id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
  url: string;
  secret_encrypted: string;
}

/**
 * Delivers every due event once. It visits each organization on its own (like the retention job), so
 * row-level security limits what it reads and updates. A 2xx answer completes a delivery; anything
 * else schedules the next attempt, and the sixth failure marks it failed. Logs counts only.
 */
export async function dispatchWebhooks(
  pool: pg.Pool,
  settings: { key: Buffer; allowPrivate: boolean; now?: Date; batch?: number },
  send: typeof postOnce = postOnce,
): Promise<DispatchReport> {
  const now = settings.now ?? new Date();
  const report: DispatchReport = { attempted: 0, delivered: 0, failedForGood: 0, retryLater: 0 };
  const organizations = await withTenant(pool, { retentionJob: true }, async ({ client }) => {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM organization WHERE deleted_at IS NULL ORDER BY id",
    );
    return result.rows.map((row) => row.id);
  });
  for (const organizationId of organizations) {
    const due = await withTenant(pool, { organizationId }, async ({ client }) => {
      const rows = await client.query<DueRow>(
        `SELECT d.id, d.endpoint_id, d.event_id, d.event_type, d.payload, d.attempts, e.url, e.secret_encrypted
         FROM webhook_delivery d JOIN webhook_endpoint e ON e.id = d.endpoint_id AND e.organization_id = d.organization_id
         WHERE d.status = 'pending' AND d.next_attempt_at <= $1 AND e.disabled_at IS NULL
         ORDER BY d.next_attempt_at, d.id LIMIT $2`,
        [now, settings.batch ?? 50],
      );
      return rows.rows;
    });
    for (const row of due) {
      report.attempted++;
      const body = JSON.stringify(row.payload);
      const seconds = Math.floor(now.getTime() / 1000);
      let outcome: Awaited<ReturnType<typeof postOnce>>;
      try {
        const secret = decryptSecret(row.secret_encrypted, settings.key);
        outcome = await send(
          row.url,
          body,
          {
            "content-type": "application/json",
            "user-agent": "Loadlane-Webhooks/1",
            "x-loadlane-event": row.event_type,
            "x-loadlane-event-id": row.event_id,
            "x-loadlane-signature": signPayload(secret, body, seconds),
          },
          { allowPrivate: settings.allowPrivate },
        );
      } catch {
        outcome = { error: "connection_failed" };
      }
      const statusCode = "statusCode" in outcome ? outcome.statusCode : null;
      const ok = statusCode !== null && statusCode >= 200 && statusCode < 300;
      const attempts = row.attempts + 1;
      const delay = nextRetryDelayMs(attempts);
      const errorCode = ok ? null : "error" in outcome ? outcome.error : `http_${statusCode}`;
      const status = ok ? "delivered" : delay === undefined ? "failed" : "pending";
      if (ok) report.delivered++;
      else if (status === "failed") report.failedForGood++;
      else report.retryLater++;
      await withTenant(pool, { organizationId }, async ({ client }) => {
        await client.query(
          `UPDATE webhook_delivery SET status = $2, attempts = $3, last_status_code = $4, last_error_code = $5,
             next_attempt_at = $6, delivered_at = $7 WHERE id = $1`,
          [
            row.id,
            status,
            attempts,
            statusCode,
            errorCode,
            new Date(now.getTime() + (delay ?? 0)),
            ok ? now : null,
          ],
        );
      });
    }
  }
  return report;
}
