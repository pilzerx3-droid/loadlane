import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { appDatabaseUrlFromEnv } from "./env.ts";
import * as schema from "./schema/index.ts";

export type Db = NodePgDatabase<typeof schema>;

export interface TenantContext {
  /** The organization the request acts for. Without it, every tenant table is empty and read-only. */
  organizationId?: string;
  /** The signed-in person. Used for the organization switcher and for self-service on app_user. */
  userId?: string;
  /**
   * Sign-in identity from a verified token. Lets the API look up or register the person before
   * their user id is known (migration 0003). Set it only from a token that has been verified.
   */
  authIssuer?: string;
  authSubject?: string;
  /**
   * SHA-256 hex of a presented Driver Link token (migration 0008). Makes exactly that one link row
   * visible so the API can resolve the organization. Set it only from a token the request carried.
   */
  driverTokenHash?: string;
  /** SHA-256 hex of a presented customer tracking token (migration 0011). Same idea as above. */
  trackingTokenHash?: string;
  /** SHA-256 hex of a presented spot freight invitation token (migration 0014). */
  spotTokenHash?: string;
  /**
   * Set only by the retention job (migration 0015): lets it list organizations to visit them one by
   * one. Everything it deletes is still limited by the organization it acts for.
   */
  retentionJob?: boolean;
  /** SHA-256 hex of a presented API key (migration 0018). Makes exactly that key's row visible. */
  apiKeyHash?: string;
}

export interface TenantSession {
  db: Db;
  /** The raw connection of this transaction, for statements Drizzle cannot express. */
  client: pg.PoolClient;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(name: string, value: string | undefined): string {
  if (value === undefined) return "";
  if (!UUID_PATTERN.test(value)) throw new TypeError(`${name} must be a UUID`);
  return value;
}

function assertText(name: string, value: string | undefined): string {
  if (value === undefined) return "";
  if (value.length === 0 || value.length > 2048)
    throw new TypeError(`${name} must be 1 to 2048 characters`);
  return value;
}

/** Pool for the application role (loadlane_app). It is subject to row-level security. */
export function createAppPool(connectionString: string = appDatabaseUrlFromEnv()): pg.Pool {
  return new pg.Pool({ connectionString });
}

/**
 * Runs `fn` in one transaction in which the tenant is set for row-level security (ADR 0002).
 * The settings are transaction-local, so they cannot leak to the next user of a pooled connection.
 * Commits when `fn` resolves and rolls back when it throws.
 *
 * Callers must have verified that the user may act for the organization (P1-06 and P1-07) before
 * passing it in: row-level security separates tenants, it does not check who may use which tenant.
 */
export async function withTenant<T>(
  pool: pg.Pool,
  context: TenantContext,
  fn: (session: TenantSession) => Promise<T>,
): Promise<T> {
  const organizationId = assertUuid("organizationId", context.organizationId);
  const userId = assertUuid("userId", context.userId);
  const authIssuer = assertText("authIssuer", context.authIssuer);
  const authSubject = assertText("authSubject", context.authSubject);
  const driverTokenHash = assertText("driverTokenHash", context.driverTokenHash);
  const trackingTokenHash = assertText("trackingTokenHash", context.trackingTokenHash);
  const spotTokenHash = assertText("spotTokenHash", context.spotTokenHash);
  const retentionJob = context.retentionJob === true ? "on" : "";
  const apiKeyHash = assertText("apiKeyHash", context.apiKeyHash);

  const client = await pool.connect();
  let brokenConnection: Error | undefined;
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.organization_id', $1, true), set_config('app.user_id', $2, true),
              set_config('app.auth_issuer', $3, true), set_config('app.auth_subject', $4, true),
              set_config('app.driver_token_hash', $5, true),
              set_config('app.tracking_token_hash', $6, true),
              set_config('app.spot_token_hash', $7, true),
              set_config('app.retention_job', $8, true),
              set_config('app.api_key_hash', $9, true)`,
      [
        organizationId,
        userId,
        authIssuer,
        authSubject,
        driverTokenHash,
        trackingTokenHash,
        spotTokenHash,
        retentionJob,
        apiKeyHash,
      ],
    );
    const result = await fn({ db: drizzle({ client, schema }), client });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      brokenConnection = new Error("ROLLBACK failed, discarding the connection", {
        cause: rollbackError,
      });
    }
    throw error;
  } finally {
    client.release(brokenConnection);
  }
}
