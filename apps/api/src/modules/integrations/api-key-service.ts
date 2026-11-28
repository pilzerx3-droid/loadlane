import { NotFoundException } from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import type pg from "pg";
import { hashCapabilityToken, newCapabilityToken } from "../../platform/capability-token.ts";
import type { CreateKeyInput, CreatedKey, KeySummary } from "./integration.schemas.ts";

export interface KeyContext {
  organizationId: string;
  userId: string;
  requestId?: string | undefined;
}

type Row = Record<string, unknown>;

/** Shown in lists to recognize a key; the rest of the key is never stored. */
export const KEY_PREFIX_LENGTH = 12;
export const KEY_PREFIX = "ll_live_";

/** A new key: a recognizable prefix plus 256 random bits. */
export function newApiKey(): string {
  return `${KEY_PREFIX}${newCapabilityToken()}`;
}

function summaryOf(row: Row): KeySummary {
  const revokedAt = row["revoked_at"] as Date | null;
  const lastUsed = row["last_used_at"] as Date | null;
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    prefix: row["key_prefix"] as string,
    scopes: row["scopes"] as KeySummary["scopes"],
    state: revokedAt ? "revoked" : "active",
    createdAt: (row["created_at"] as Date).toISOString(),
    lastUsedAt: lastUsed ? lastUsed.toISOString() : null,
    revokedAt: revokedAt ? revokedAt.toISOString() : null,
    createdBy: {
      id: row["created_by_user_id"] as string,
      displayName: row["display_name"] as string,
    },
  };
}

const SELECT = `SELECT k.id, k.name, k.key_prefix, k.scopes, k.created_at, k.last_used_at, k.revoked_at,
  k.created_by_user_id, u.display_name FROM api_key k JOIN app_user u ON u.id = k.created_by_user_id`;

/** Staff side of API keys: create (shown once), list, revoke. Keys are never edited. */
export class ApiKeyService {
  constructor(private readonly pool: pg.Pool) {}

  async create(context: KeyContext, input: CreateKeyInput): Promise<CreatedKey> {
    const key = newApiKey();
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const inserted = await client.query<Row>(
        `INSERT INTO api_key (organization_id, name, key_prefix, key_hash, scopes, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          context.organizationId,
          input.name,
          key.slice(0, KEY_PREFIX_LENGTH),
          hashCapabilityToken(key),
          input.scopes,
          context.userId,
        ],
      );
      const id = (inserted.rows[0] as Row)["id"] as string;
      await this.audit(client, context, "api_key.created", id, {
        name: input.name,
        scopes: input.scopes,
      });
      const row = await client.query<Row>(`${SELECT} WHERE k.id = $1`, [id]);
      return { ...summaryOf(row.rows[0] ?? {}), key };
    });
  }

  async list(context: KeyContext): Promise<KeySummary[]> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const rows = await client.query<Row>(`${SELECT} ORDER BY k.created_at DESC, k.id DESC`);
      return rows.rows.map(summaryOf);
    });
  }

  /** Revoking twice is harmless and keeps the first revocation. The key stops working at once. */
  async revoke(context: KeyContext, id: string): Promise<KeySummary> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const found = await client.query("SELECT 1 FROM api_key WHERE id = $1", [id]);
      if (found.rowCount === 0) throw new NotFoundException();
      const result = await client.query(
        "UPDATE api_key SET revoked_at = now(), revoked_by_user_id = $2 WHERE id = $1 AND revoked_at IS NULL",
        [id, context.userId],
      );
      if (result.rowCount === 1) await this.audit(client, context, "api_key.revoked", id, {});
      const row = await client.query<Row>(`${SELECT} WHERE k.id = $1`, [id]);
      return summaryOf(row.rows[0] ?? {});
    });
  }

  private tenant(context: KeyContext) {
    return { organizationId: context.organizationId, userId: context.userId };
  }

  private async audit(
    client: pg.PoolClient,
    context: KeyContext,
    action: string,
    entityId: string,
    changes: unknown,
  ): Promise<void> {
    // The key itself never appears in an audit entry.
    await client.query(
      `INSERT INTO audit_log (organization_id, actor_type, actor_user_id, action, entity_type, entity_id, changes, request_id)
       VALUES ($1, 'user', $2, $3, 'api_key', $4, $5, $6)`,
      [
        context.organizationId,
        context.userId,
        action,
        entityId,
        JSON.stringify(changes),
        context.requestId ?? null,
      ],
    );
  }
}
