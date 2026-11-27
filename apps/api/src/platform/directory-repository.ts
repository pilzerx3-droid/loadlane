import { ConflictException, NotFoundException } from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import type pg from "pg";
import { pgErrorInfo } from "./pg-error.ts";

/**
 * Master data that an organization keeps for itself (customers, carriers, locations): a list, one
 * record, create, edit, archive. It runs under row-level security through withTenant() and writes an
 * audit entry in the same transaction. Table and field names come from code constants, never from
 * requests; values are always passed as parameters.
 */
export interface DirectoryConfig {
  /** Table name, also the audit entity type. */
  table: string;
  /** Editable columns in camelCase. */
  fields: readonly string[];
  /** Columns that are returned but never written by the API, in camelCase. */
  readOnlyFields?: readonly string[];
  /** Columns searched by the `q` filter (case-insensitive substring), in camelCase. */
  searchFields: readonly string[];
}

export interface DirectoryContext {
  organizationId: string;
  userId: string;
  requestId?: string | undefined;
}

export interface DirectoryListQuery {
  limit: number;
  offset: number;
  q?: string | undefined;
  includeArchived: boolean;
}

export type DirectoryRecord = Record<string, unknown> & { id: string };

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*$/;

function snake(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function camelKeys(row: Record<string, unknown>): DirectoryRecord {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "organization_id") continue;
    result[key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return result as DirectoryRecord;
}

/** Escapes LIKE wildcards so that a search for "100%" finds "100%" and not everything. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export class DirectoryRepository {
  private readonly columns: string;

  constructor(
    private readonly pool: pg.Pool,
    private readonly config: DirectoryConfig,
  ) {
    for (const name of [config.table, ...config.fields, ...config.searchFields]) {
      if (!IDENTIFIER.test(name.replace(/_/g, "a")))
        throw new TypeError(`unsafe identifier: ${name}`);
    }
    this.columns = [
      "id",
      ...config.fields.map(snake),
      ...(config.readOnlyFields ?? []).map(snake),
      "archived_at",
      "created_at",
      "updated_at",
    ].join(", ");
  }

  private tenant(context: DirectoryContext) {
    return { organizationId: context.organizationId, userId: context.userId };
  }

  async list(
    context: DirectoryContext,
    query: DirectoryListQuery,
  ): Promise<{ rows: DirectoryRecord[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!query.includeArchived) conditions.push("archived_at IS NULL");
    if (query.q) {
      params.push(likePattern(query.q));
      const search = this.config.searchFields
        .map((field) => `${snake(field)} ILIKE $${params.length}`)
        .join(" OR ");
      conditions.push(`(${search})`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const total = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM "${this.config.table}" ${where}`,
        params,
      );
      const rows = await client.query<Record<string, unknown>>(
        `SELECT ${this.columns} FROM "${this.config.table}" ${where} ORDER BY lower(name), id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.limit, query.offset],
      );
      return { rows: rows.rows.map(camelKeys), total: total.rows[0]?.n ?? 0 };
    });
  }

  async get(context: DirectoryContext, id: string): Promise<DirectoryRecord> {
    const row = await withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT ${this.columns} FROM "${this.config.table}" WHERE id = $1`,
        [id],
      );
      return result.rows[0];
    });
    if (!row) throw new NotFoundException();
    return camelKeys(row);
  }

  async create(
    context: DirectoryContext,
    input: Record<string, unknown>,
  ): Promise<DirectoryRecord> {
    const fields = this.config.fields.filter((field) => input[field] !== undefined);
    const columns = ["organization_id", ...fields.map(snake)];
    const values = [context.organizationId, ...fields.map((field) => input[field])];
    try {
      return await withTenant(this.pool, this.tenant(context), async ({ client }) => {
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
        const result = await client.query<Record<string, unknown>>(
          `INSERT INTO "${this.config.table}" (${columns.join(", ")}) VALUES (${placeholders}) RETURNING ${this.columns}`,
          values,
        );
        const row = camelKeys(result.rows[0] ?? {});
        await this.audit(client, context, "created", row.id, { after: input });
        return row;
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  /** Applies the given fields (and `archived`) to a record. Fields left out stay as they are. */
  async update(
    context: DirectoryContext,
    id: string,
    patch: Record<string, unknown> & { archived?: boolean | undefined },
  ): Promise<DirectoryRecord> {
    try {
      return await withTenant(this.pool, this.tenant(context), async ({ client }) => {
        const current = await client.query<Record<string, unknown>>(
          `SELECT ${this.columns} FROM "${this.config.table}" WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const before = current.rows[0] ? camelKeys(current.rows[0]) : undefined;
        if (!before) throw new NotFoundException();

        const changed = this.config.fields.filter(
          (field) => patch[field] !== undefined && patch[field] !== before[field],
        );
        const sets = changed.map((field, index) => `${snake(field)} = $${index + 2}`);
        const values: unknown[] = changed.map((field) => patch[field]);
        let action = "updated";
        const wasArchived = before["archivedAt"] !== null;
        if (patch.archived === true && !wasArchived) {
          sets.push("archived_at = now()");
          action = "archived";
        } else if (patch.archived === false && wasArchived) {
          sets.push("archived_at = NULL");
          action = "restored";
        }
        if (sets.length === 0) return before;

        const result = await client.query<Record<string, unknown>>(
          `UPDATE "${this.config.table}" SET ${sets.join(", ")} WHERE id = $1 RETURNING ${this.columns}`,
          [id, ...values],
        );
        const after = camelKeys(result.rows[0] ?? {});
        await this.audit(client, context, action, id, {
          before: Object.fromEntries(changed.map((field) => [field, before[field]])),
          after: Object.fromEntries(changed.map((field) => [field, after[field]])),
        });
        return after;
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  private async audit(
    client: pg.PoolClient,
    context: DirectoryContext,
    action: string,
    entityId: string,
    changes: unknown,
  ): Promise<void> {
    // OPEN (legal, ADR 0002): ip and user agent are not recorded until their retention is decided.
    await client.query(
      `INSERT INTO audit_log (organization_id, actor_type, actor_user_id, action, entity_type, entity_id, changes, request_id)
       VALUES ($1, 'user', $2, $3, $4, $5, $6, $7)`,
      [
        context.organizationId,
        context.userId,
        `${this.config.table}.${action}`,
        this.config.table,
        entityId,
        JSON.stringify(changes),
        context.requestId ?? null,
      ],
    );
  }

  private translate(error: unknown): unknown {
    if (pgErrorInfo(error).code === "23505") {
      return new ConflictException({
        statusCode: 409,
        code: "name_taken",
        message: `An active ${this.config.table} with this name already exists.`,
      });
    }
    return error;
  }
}
