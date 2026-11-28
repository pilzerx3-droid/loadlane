import { ConflictException, NotFoundException } from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import { applyTariff, versionInForce, type Quantities, type TariffLine } from "@loadlane/shared";
import type pg from "pg";
import { ValidationFailedError } from "../../platform/validation.ts";
import type {
  ApplyInput,
  ApplyResultOut,
  CreateTariffInput,
  NewVersionInput,
  TariffDetail,
  TariffList,
  TariffListQuery,
  TariffSummary,
} from "./tariff.schemas.ts";

export interface TariffContext {
  organizationId: string;
  userId: string;
  requestId?: string | undefined;
}

type Row = Record<string, unknown>;
type StoredLine = {
  kind: TariffLine["kind"];
  label: string;
  unit: TariffLine["unit"];
  rateCents: number;
  minimumCents?: number | null;
};

const SUMMARY_SQL = `
  SELECT t.id, t.name, t.kind, t.archived_at, t.created_at,
         COALESCE(t.customer_id, t.carrier_id) AS party_id, COALESCE(cu.name, ca.name) AS party_name,
         (SELECT count(*)::int FROM tariff_version v WHERE v.tariff_id = t.id) AS versions,
         (SELECT max(v.valid_from)::text FROM tariff_version v WHERE v.tariff_id = t.id) AS latest_valid_from
  FROM tariff t
  LEFT JOIN customer cu ON cu.id = t.customer_id AND cu.organization_id = t.organization_id
  LEFT JOIN carrier ca ON ca.id = t.carrier_id AND ca.organization_id = t.organization_id`;

function summaryOf(row: Row): TariffSummary {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    kind: row["kind"] as "sell" | "buy",
    party: row["party_id"]
      ? { id: row["party_id"] as string, name: row["party_name"] as string }
      : null,
    archived: row["archived_at"] !== null,
    versions: Number(row["versions"]),
    latestValidFrom: row["latest_valid_from"] as string | null,
    createdAt: (row["created_at"] as Date).toISOString(),
  };
}

function versionOf(row: Row) {
  return {
    id: row["id"] as string,
    version: Number(row["version"]),
    validFrom: row["valid_from"] as string,
    note: row["note"] as string | null,
    lines: (row["lines"] as StoredLine[]).map((line) => ({
      kind: line.kind,
      label: line.label,
      unit: line.unit,
      rateCents: line.rateCents,
      minimumCents: line.minimumCents ?? null,
    })),
    createdAt: (row["created_at"] as Date).toISOString(),
    createdBy: {
      id: row["created_by_user_id"] as string,
      displayName: row["display_name"] as string,
    },
  };
}

const VERSION_SQL = `SELECT v.id, v.version, v.valid_from::text AS valid_from, v.note, v.lines, v.created_at,
  v.created_by_user_id, u.display_name FROM tariff_version v JOIN app_user u ON u.id = v.created_by_user_id`;

/** Price lists with immutable, dated versions (ADR 0007). */
export class TariffService {
  constructor(private readonly pool: pg.Pool) {}

  async create(context: TariffContext, input: CreateTariffInput): Promise<TariffDetail> {
    if (input.kind === "sell" && input.carrierId) {
      throw new ValidationFailedError([
        {
          path: "carrierId",
          message: "a sell tariff belongs to a customer, not a carrier",
          code: "invalid_value",
        },
      ]);
    }
    if (input.kind === "buy" && input.customerId) {
      throw new ValidationFailedError([
        {
          path: "customerId",
          message: "a buy tariff belongs to a carrier, not a customer",
          code: "invalid_value",
        },
      ]);
    }
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const partyTable = input.customerId ? "customer" : input.carrierId ? "carrier" : undefined;
      const partyId = input.customerId ?? input.carrierId;
      if (partyTable && partyId) {
        const party = await client.query(
          `SELECT 1 FROM ${partyTable} WHERE id = $1 AND archived_at IS NULL`,
          [partyId],
        );
        if (party.rowCount === 0) {
          throw new ValidationFailedError([
            {
              path: partyTable === "customer" ? "customerId" : "carrierId",
              message: "not found or archived",
              code: "invalid_reference",
            },
          ]);
        }
      }
      const inserted = await client.query<Row>(
        `INSERT INTO tariff (organization_id, name, kind, customer_id, carrier_id, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          context.organizationId,
          input.name,
          input.kind,
          input.customerId ?? null,
          input.carrierId ?? null,
          context.userId,
        ],
      );
      const id = (inserted.rows[0] as Row)["id"] as string;
      await this.insertVersion(
        client,
        context,
        id,
        1,
        input.validFrom,
        input.note ?? null,
        input.lines,
      );
      await this.audit(client, context, "tariff.created", id, {
        kind: input.kind,
        name: input.name,
      });
      return this.load(client, id);
    });
  }

  async list(context: TariffContext, query: TariffListQuery): Promise<TariffList> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const params: unknown[] = [];
      const where: string[] = [
        query.archived ? "t.archived_at IS NOT NULL" : "t.archived_at IS NULL",
      ];
      if (query.kind) {
        params.push(query.kind);
        where.push(`t.kind = $${params.length}::tariff_kind`);
      }
      const clause = `WHERE ${where.join(" AND ")}`;
      const total = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM tariff t ${clause}`,
        params,
      );
      const rows = await client.query<Row>(
        `${SUMMARY_SQL} ${clause} ORDER BY t.name, t.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.limit, query.offset],
      );
      return {
        items: rows.rows.map(summaryOf),
        page: { limit: query.limit, offset: query.offset, total: total.rows[0]?.n ?? 0 },
      };
    });
  }

  async get(context: TariffContext, id: string): Promise<TariffDetail> {
    return withTenant(this.pool, this.tenant(context), (s) => this.load(s.client, id));
  }

  /** A change of rates is a new version with a new start date. Old versions stay as they were. */
  async addVersion(
    context: TariffContext,
    id: string,
    input: NewVersionInput,
  ): Promise<TariffDetail> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const tariff = await client.query<Row>(
        "SELECT archived_at FROM tariff WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!tariff.rows[0]) throw new NotFoundException();
      if (tariff.rows[0]["archived_at"] !== null) {
        throw new ConflictException({
          statusCode: 409,
          code: "tariff_archived",
          message: "An archived tariff cannot get new versions. Restore it first.",
        });
      }
      const next = await client.query<{ n: number }>(
        "SELECT COALESCE(max(version), 0)::int + 1 AS n FROM tariff_version WHERE tariff_id = $1",
        [id],
      );
      const taken = await client.query(
        "SELECT 1 FROM tariff_version WHERE tariff_id = $1 AND valid_from = $2::date",
        [id, input.validFrom],
      );
      if ((taken.rowCount ?? 0) > 0) {
        throw new ConflictException({
          statusCode: 409,
          code: "version_date_taken",
          message: "Another version already starts on this date. Choose a different start date.",
        });
      }
      const version = next.rows[0]?.n ?? 1;
      await this.insertVersion(
        client,
        context,
        id,
        version,
        input.validFrom,
        input.note ?? null,
        input.lines,
      );
      await this.audit(client, context, "tariff.version_added", id, {
        version,
        validFrom: input.validFrom,
      });
      return this.load(client, id);
    });
  }

  async setArchived(context: TariffContext, id: string, archived: boolean): Promise<TariffDetail> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const result = await client.query(
        "UPDATE tariff SET archived_at = CASE WHEN $2::boolean THEN COALESCE(archived_at, now()) ELSE NULL END WHERE id = $1",
        [id, archived],
      );
      if (result.rowCount === 0) throw new NotFoundException();
      await this.audit(client, context, archived ? "tariff.archived" : "tariff.restored", id, {});
      return this.load(client, id);
    });
  }

  /**
   * Prices a shipment with the version in force on the given date. The result names the exact
   * version, so a calculation built from it can record which rates it used.
   */
  async apply(context: TariffContext, id: string, input: ApplyInput): Promise<ApplyResultOut> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const tariff = await client.query<Row>("SELECT name FROM tariff WHERE id = $1", [id]);
      if (!tariff.rows[0]) throw new NotFoundException();
      const versions = await client.query<Row>(`${VERSION_SQL} WHERE v.tariff_id = $1`, [id]);
      const all = versions.rows.map(versionOf);
      const inForce = versionInForce(all, input.date);
      if (!inForce) {
        throw new ConflictException({
          statusCode: 409,
          code: "no_version_in_force",
          message: "No version of this tariff is in force on that date.",
        });
      }
      const quantities: Quantities = {};
      for (const unit of ["mile", "pallet", "lb", "hour"] as const) {
        const value = input.quantities[unit];
        if (value !== undefined) quantities[unit] = Math.round(value * 1000);
      }
      const result = applyTariff(
        inForce.lines.map((line) => ({
          kind: line.kind,
          label: line.label,
          unit: line.unit,
          rate: line.rateCents,
          ...(line.minimumCents === null ? {} : { minimum: line.minimumCents }),
        })),
        quantities,
      );
      if (!result.ok) {
        throw new ValidationFailedError(
          result.missingUnits.map((unit) => ({
            path: `quantities.${unit}`,
            message: `this tariff needs a quantity for ${unit}`,
            code: "required",
          })),
        );
      }
      return {
        tariffId: id,
        tariffName: tariff.rows[0]["name"] as string,
        versionId: inForce.id,
        version: inForce.version,
        validFrom: inForce.validFrom,
        lines: result.lines.map((line) => ({
          kind: line.kind,
          label: line.label,
          amountCents: line.amount,
          minimumApplied: line.minimumApplied,
          basis: line.basis
            ? {
                rateCents: line.basis.rate,
                quantityThousandths: line.basis.quantityThousandths,
                unit: line.basis.unit,
              }
            : null,
        })),
        totalCents: result.total,
      };
    });
  }

  private async insertVersion(
    client: pg.PoolClient,
    context: TariffContext,
    tariffId: string,
    version: number,
    validFrom: string,
    note: string | null,
    lines: NewVersionInput["lines"],
  ): Promise<void> {
    await client.query(
      `INSERT INTO tariff_version (organization_id, tariff_id, version, valid_from, note, lines, created_by_user_id)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7)`,
      [
        context.organizationId,
        tariffId,
        version,
        validFrom,
        note,
        JSON.stringify(lines),
        context.userId,
      ],
    );
  }

  private async load(client: pg.PoolClient, id: string): Promise<TariffDetail> {
    const summary = await client.query<Row>(`${SUMMARY_SQL} WHERE t.id = $1`, [id]);
    if (!summary.rows[0]) throw new NotFoundException();
    const versions = await client.query<Row>(
      `${VERSION_SQL} WHERE v.tariff_id = $1 ORDER BY v.version DESC`,
      [id],
    );
    const all = versions.rows.map(versionOf);
    const today = await client.query<{ today: string }>(
      "SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM organization LIMIT 1",
    );
    return {
      ...summaryOf(summary.rows[0]),
      currentVersion:
        versionInForce(all, today.rows[0]?.today ?? new Date().toISOString().slice(0, 10)) ?? null,
      allVersions: all,
    };
  }

  private tenant(context: TariffContext) {
    return { organizationId: context.organizationId, userId: context.userId };
  }

  private async audit(
    client: pg.PoolClient,
    context: TariffContext,
    action: string,
    entityId: string,
    changes: unknown,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (organization_id, actor_type, actor_user_id, action, entity_type, entity_id, changes, request_id)
       VALUES ($1, 'user', $2, $3, 'tariff', $4, $5, $6)`,
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
