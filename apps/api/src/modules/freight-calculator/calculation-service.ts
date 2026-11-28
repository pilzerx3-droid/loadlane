import { NotFoundException } from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import {
  MoneyError,
  calculate,
  lineFromRate,
  type CostLine,
  type PricingMethod,
} from "@loadlane/shared";
import type pg from "pg";
import { ValidationFailedError } from "../../platform/validation.ts";
import type {
  CalculationDetail,
  CalculationList,
  CalculationSummary,
  CreateCalculationInput,
} from "./calculation.schemas.ts";

/** Raise when the rules of the calculation change in a way that could change old results. */
export const ENGINE_VERSION = 1;

export interface CalculationContext {
  organizationId: string;
  userId: string;
  requestId?: string | undefined;
}

type Row = Record<string, unknown>;

function pricingOf(input: CreateCalculationInput["pricing"]): PricingMethod {
  switch (input.mode) {
    case "markup":
      return { mode: "markup", rate: input.rateBp };
    case "margin":
      return { mode: "margin", rate: input.rateBp };
    case "contribution":
      return { mode: "contribution", amount: input.amountCents };
    case "price":
      return { mode: "price", amount: input.amountCents };
  }
}

function linesOf(input: CreateCalculationInput["lines"]): CostLine[] {
  return input.map((line) =>
    "amountCents" in line
      ? { kind: line.kind, label: line.label, amount: line.amountCents }
      : lineFromRate(line.kind, line.label, line.rateCents, line.quantityThousandths, line.unit),
  );
}

const COLUMNS = `c.id, c.name, c.customer_id, cu.name AS customer_name, c.pricing_mode, c.engine_version,
  c.cost_cents, c.price_cents, c.contribution_cents, c.markup_bp, c.margin_bp, c.result,
  c.created_at, c.created_by_user_id, u.display_name`;
const FROM = `calculation c JOIN app_user u ON u.id = c.created_by_user_id
  LEFT JOIN customer cu ON cu.id = c.customer_id AND cu.organization_id = c.organization_id`;

function summaryOf(row: Row): CalculationSummary {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    customer:
      row["customer_id"] === null
        ? null
        : { id: row["customer_id"] as string, name: row["customer_name"] as string },
    pricingMode: row["pricing_mode"] as CalculationSummary["pricingMode"],
    costCents: Number(row["cost_cents"]),
    priceCents: Number(row["price_cents"]),
    contributionCents: Number(row["contribution_cents"]),
    markupBp: row["markup_bp"] as number | null,
    marginBp: row["margin_bp"] as number | null,
    createdAt: (row["created_at"] as Date).toISOString(),
    createdBy: {
      id: row["created_by_user_id"] as string,
      displayName: row["display_name"] as string,
    },
  };
}

interface StoredResult {
  tariffVersions?: CalculationDetail["tariffVersions"];
  lines: CostLine[];
  costByKind: CalculationDetail["costByKind"];
  pricing: PricingMethod;
}

function detailOf(row: Row): CalculationDetail {
  const result = row["result"] as StoredResult;
  return {
    ...summaryOf(row),
    engineVersion: row["engine_version"] as number,
    lines: result.lines.map((line) => ({
      kind: line.kind,
      label: line.label,
      amountCents: line.amount,
      basis: line.basis
        ? {
            rateCents: line.basis.rate,
            quantityThousandths: line.basis.quantityThousandths,
            unit: line.basis.unit,
          }
        : null,
    })),
    costByKind: result.costByKind,
    tariffVersions: result.tariffVersions ?? [],
    pricing: Object.fromEntries(
      Object.entries(result.pricing).map(([key, value]) => [
        key === "rate" ? "rateBp" : key === "amount" ? "amountCents" : key,
        value,
      ]),
    ),
  };
}

/**
 * Freight calculations (ADR 0007). A calculation is computed once by the shared engine and stored
 * as a snapshot: later changes to rules or tariffs never alter it.
 */
export class CalculationService {
  constructor(private readonly pool: pg.Pool) {}

  async create(
    context: CalculationContext,
    input: CreateCalculationInput,
  ): Promise<CalculationDetail> {
    let result;
    try {
      result = calculate({ lines: linesOf(input.lines), pricing: pricingOf(input.pricing) });
    } catch (error) {
      if (error instanceof MoneyError) {
        throw new ValidationFailedError([
          { path: "pricing", message: error.message, code: error.code },
        ]);
      }
      throw error;
    }
    const { analysis } = result;
    return withTenant(
      this.pool,
      { organizationId: context.organizationId, userId: context.userId },
      async ({ client }) => {
        if (input.customerId) {
          const customer = await client.query(
            "SELECT 1 FROM customer WHERE id = $1 AND archived_at IS NULL",
            [input.customerId],
          );
          if (customer.rowCount === 0) {
            throw new ValidationFailedError([
              { path: "customerId", message: "not found or archived", code: "invalid_reference" },
            ]);
          }
        }
        const tariffVersions = await this.tariffVersions(client, input.tariffVersionIds ?? []);
        const inserted = await client.query<Row>(
          `INSERT INTO calculation (organization_id, customer_id, name, engine_version, pricing_mode, input, result,
             cost_cents, price_cents, contribution_cents, markup_bp, margin_bp, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
          [
            context.organizationId,
            input.customerId ?? null,
            input.name,
            ENGINE_VERSION,
            input.pricing.mode,
            JSON.stringify(input),
            JSON.stringify({ ...result, tariffVersions }),
            analysis.cost,
            analysis.price,
            analysis.contribution,
            analysis.markup,
            analysis.margin,
            context.userId,
          ],
        );
        const id = (inserted.rows[0] as Row)["id"] as string;
        await client.query(
          `INSERT INTO audit_log (organization_id, actor_type, actor_user_id, action, entity_type, entity_id, changes, request_id)
           VALUES ($1, 'user', $2, 'calculation.created', 'calculation', $3, $4, $5)`,
          [
            context.organizationId,
            context.userId,
            id,
            JSON.stringify({
              pricingMode: input.pricing.mode,
              costCents: analysis.cost,
              priceCents: analysis.price,
            }),
            context.requestId ?? null,
          ],
        );
        const row = await client.query<Row>(`SELECT ${COLUMNS} FROM ${FROM} WHERE c.id = $1`, [id]);
        return detailOf(row.rows[0] ?? {});
      },
    );
  }

  /** The tariff versions a calculation names must exist in this organization; they are frozen into it. */
  private async tariffVersions(
    client: pg.PoolClient,
    ids: readonly string[],
  ): Promise<CalculationDetail["tariffVersions"]> {
    if (ids.length === 0) return [];
    const unique = [...new Set(ids)];
    const rows = await client.query<Row>(
      `SELECT v.id, v.version, v.valid_from::text AS valid_from, t.id AS tariff_id, t.name
       FROM tariff_version v JOIN tariff t ON t.id = v.tariff_id AND t.organization_id = v.organization_id
       WHERE v.id = ANY($1::uuid[]) ORDER BY t.name, v.version`,
      [unique],
    );
    if (rows.rowCount !== unique.length) {
      throw new ValidationFailedError([
        {
          path: "tariffVersionIds",
          message: "a tariff version was not found",
          code: "invalid_reference",
        },
      ]);
    }
    return rows.rows.map((row) => ({
      tariffId: row["tariff_id"] as string,
      tariffName: row["name"] as string,
      versionId: row["id"] as string,
      version: Number(row["version"]),
      validFrom: row["valid_from"] as string,
    }));
  }

  async list(context: CalculationContext, limit: number, offset: number): Promise<CalculationList> {
    return withTenant(
      this.pool,
      { organizationId: context.organizationId, userId: context.userId },
      async ({ client }) => {
        const total = await client.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM calculation",
        );
        const rows = await client.query<Row>(
          `SELECT ${COLUMNS} FROM ${FROM} ORDER BY c.created_at DESC, c.id DESC LIMIT $1 OFFSET $2`,
          [limit, offset],
        );
        return {
          items: rows.rows.map(summaryOf),
          page: { limit, offset, total: total.rows[0]?.n ?? 0 },
        };
      },
    );
  }

  /**
   * A new calculation from the stored input of an existing one, calculated again now. The original
   * is untouched; the copy is its own frozen snapshot. Use it to try another price.
   */
  async duplicate(
    context: CalculationContext,
    id: string,
    name: string | undefined,
  ): Promise<CalculationDetail> {
    const source = await withTenant(
      this.pool,
      { organizationId: context.organizationId, userId: context.userId },
      async ({ client }) => {
        const row = await client.query<Row>("SELECT name, input FROM calculation WHERE id = $1", [
          id,
        ]);
        if (!row.rows[0]) throw new NotFoundException();
        return row.rows[0];
      },
    );
    const input = source["input"] as CreateCalculationInput;
    const copyName = (name ?? `${String(source["name"])} (copy)`).slice(0, 120);
    return this.create(context, { ...input, name: copyName });
  }

  async get(context: CalculationContext, id: string): Promise<CalculationDetail> {
    return withTenant(
      this.pool,
      { organizationId: context.organizationId, userId: context.userId },
      async ({ client }) => {
        const row = await client.query<Row>(`SELECT ${COLUMNS} FROM ${FROM} WHERE c.id = $1`, [id]);
        if (!row.rows[0]) throw new NotFoundException();
        return detailOf(row.rows[0]);
      },
    );
  }
}
