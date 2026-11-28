import { createHash } from "node:crypto";
import { ConflictException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import type pg from "pg";
import { hashCapabilityToken } from "../../platform/capability-token.ts";
import type { TransportService } from "../transport-orders/index.ts";
import type {
  InboundResult,
  InboundTransportInput,
  LookupQuery,
  LookupResult,
} from "./integration.schemas.ts";

type Row = Record<string, unknown>;

export type ApiKeyScope = "lookup:read" | "transport:write";

/** What a valid key stands for. The organization comes from the key, never from the request. */
export interface KeyGrant {
  keyId: string;
  organizationId: string;
  /** The person who created the key; transports made through it are owned by them. */
  ownerUserId: string;
}

/** Stable text of an object: keys sorted, so the same content always gives the same hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const TABLES = {
  customers: {
    table: "customer",
    extra: "NULL::text AS city, NULL::text AS state, NULL::text AS timezone",
  },
  carriers: {
    table: "carrier",
    extra: "NULL::text AS city, NULL::text AS state, NULL::text AS timezone",
  },
  locations: { table: "location", extra: "city, state, timezone" },
} as const;

/**
 * The integration API for other systems (ADR 0009): look up the ids of master data, create
 * transports safely (idempotent by the external id). A key can do only what its scopes list.
 */
export class IntegrationService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly transports: TransportService,
  ) {}

  /** Resolves the key and checks its scope. Unknown and revoked keys get the same answer. */
  async authenticate(key: unknown, scope: ApiKeyScope): Promise<KeyGrant> {
    if (typeof key !== "string" || key.length < 20 || key.length > 200) throw this.unauthorized();
    const found = await withTenant(
      this.pool,
      { apiKeyHash: hashCapabilityToken(key) },
      async ({ client }) => {
        const result = await client.query<Row>(
          "SELECT id, organization_id, created_by_user_id, scopes, revoked_at FROM api_key",
        );
        return result.rows[0];
      },
    );
    if (!found || found["revoked_at"]) throw this.unauthorized();
    if (!(found["scopes"] as string[]).includes(scope)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: "scope_missing",
        message: `This API key does not have the scope ${scope}.`,
      });
    }
    const grant: KeyGrant = {
      keyId: found["id"] as string,
      organizationId: found["organization_id"] as string,
      ownerUserId: found["created_by_user_id"] as string,
    };
    // Remember the use, at most once a minute so a busy system does not write on every call.
    await withTenant(this.pool, { organizationId: grant.organizationId }, (s) =>
      s.client.query(
        "UPDATE api_key SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')",
        [grant.keyId],
      ),
    );
    return grant;
  }

  async lookup(
    grant: KeyGrant,
    kind: keyof typeof TABLES,
    query: LookupQuery,
  ): Promise<LookupResult> {
    const { table, extra } = TABLES[kind];
    return withTenant(this.pool, { organizationId: grant.organizationId }, async ({ client }) => {
      const params: unknown[] = [];
      let where = "WHERE archived_at IS NULL";
      if (query.q) {
        params.push(`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
        where += ` AND name ILIKE $${params.length}`;
      }
      const total = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} ${where}`,
        params,
      );
      const rows = await client.query<Row>(
        `SELECT id, name, ${extra} FROM ${table} ${where} ORDER BY name, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.limit, query.offset],
      );
      return {
        items: rows.rows.map((row) => ({
          id: row["id"] as string,
          name: row["name"] as string,
          city: row["city"] as string | null,
          state: row["state"] as string | null,
          timezone: row["timezone"] as string | null,
        })),
        page: { limit: query.limit, offset: query.offset, total: total.rows[0]?.n ?? 0 },
      };
    });
  }

  /**
   * Creates a transport once per external id. Sending the same content again returns the same
   * transport; the same id with different content is a conflict, never a silent overwrite.
   */
  async createTransport(grant: KeyGrant, input: InboundTransportInput): Promise<InboundResult> {
    const requestHash = createHash("sha256").update(canonicalJson(input.transport)).digest("hex");
    const context = {
      organizationId: grant.organizationId,
      userId: grant.ownerUserId,
      apiKeyId: grant.keyId,
    };
    const existing = await withTenant(
      this.pool,
      { organizationId: grant.organizationId },
      async ({ client }) => {
        const result = await client.query<Row>(
          "SELECT internal_id, request_hash FROM external_ref WHERE entity_type = 'transport' AND external_id = $1",
          [input.externalId],
        );
        return result.rows[0];
      },
    );
    if (existing) return this.repeat(grant, existing, requestHash);

    try {
      const transport = await withTenant(
        this.pool,
        { organizationId: grant.organizationId },
        async ({ client }) => {
          const created = await this.transports.createWithin(client, context, input.transport);
          await client.query(
            `INSERT INTO external_ref (organization_id, api_key_id, entity_type, external_id, internal_id, request_hash)
           VALUES ($1, $2, 'transport', $3, $4, $5)`,
            [grant.organizationId, grant.keyId, input.externalId, created.id, requestHash],
          );
          return created;
        },
      );
      return { created: true, transport };
    } catch (error) {
      // Two calls with the same external id at once: the loser finds the winner's record.
      if ((error as { code?: string }).code === "23505") {
        const winner = await withTenant(
          this.pool,
          { organizationId: grant.organizationId },
          async ({ client }) => {
            const result = await client.query<Row>(
              "SELECT internal_id, request_hash FROM external_ref WHERE entity_type = 'transport' AND external_id = $1",
              [input.externalId],
            );
            return result.rows[0];
          },
        );
        if (winner) return this.repeat(grant, winner, requestHash);
      }
      throw error;
    }
  }

  private async repeat(
    grant: KeyGrant,
    existing: Row,
    requestHash: string,
  ): Promise<InboundResult> {
    if (existing["request_hash"] !== requestHash) {
      throw new ConflictException({
        statusCode: 409,
        code: "external_id_conflict",
        message:
          "This externalId was already received with different content. Use a new externalId for a new shipment.",
      });
    }
    const transport = await this.transports.get(
      { organizationId: grant.organizationId, userId: grant.ownerUserId },
      existing["internal_id"] as string,
    );
    return { created: false, transport };
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      statusCode: 401,
      code: "invalid_api_key",
      message: "The API key is missing, unknown or revoked.",
    });
  }
}
