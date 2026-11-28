import { ConflictException, NotFoundException } from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import {
  canQuoteTransition,
  isQuoteEditable,
  isQuoteExpired,
  nextQuoteStatuses,
  type QuoteStatus,
} from "@loadlane/shared";
import type pg from "pg";
import { ValidationFailedError } from "../../platform/validation.ts";
import type { QuotePdfData } from "./quote-pdf.ts";
import type {
  CreateQuoteInput,
  QuoteDetail,
  QuoteList,
  QuoteListQuery,
  QuoteSummary,
  UpdateQuoteInput,
} from "./quote.schemas.ts";

export interface QuoteContext {
  organizationId: string;
  userId: string;
  requestId?: string | undefined;
}

type Row = Record<string, unknown>;

export function quoteReference(number: number): string {
  return `QT-${String(Number(number)).padStart(6, "0")}`;
}

const COLUMNS = `q.id, q.number, q.status, q.price_cents, q.valid_until::text AS valid_until, q.terms, q.notes,
  q.sent_at, q.decided_at, q.created_at, q.created_by_user_id, u.display_name,
  q.customer_id, cu.name AS customer_name, q.calculation_id, ca.name AS calculation_name,
  ca.cost_cents, ca.contribution_cents, ca.markup_bp, ca.margin_bp, q.transport_id, tr.number AS transport_number`;
const FROM = `quote q
  JOIN app_user u ON u.id = q.created_by_user_id
  JOIN customer cu ON cu.id = q.customer_id AND cu.organization_id = q.organization_id
  JOIN calculation ca ON ca.id = q.calculation_id AND ca.organization_id = q.organization_id
  LEFT JOIN transport tr ON tr.id = q.transport_id AND tr.organization_id = q.organization_id`;

function summaryOf(row: Row, today: string): QuoteSummary {
  const status = row["status"] as QuoteStatus;
  const validUntil = row["valid_until"] as string;
  return {
    id: row["id"] as string,
    number: Number(row["number"]),
    reference: quoteReference(Number(row["number"])),
    status,
    expired: isQuoteExpired(status, validUntil, today),
    customer: { id: row["customer_id"] as string, name: row["customer_name"] as string },
    calculationName: row["calculation_name"] as string,
    priceCents: Number(row["price_cents"]),
    validUntil,
    createdAt: (row["created_at"] as Date).toISOString(),
  };
}

function detailOf(row: Row, today: string): QuoteDetail {
  const status = row["status"] as QuoteStatus;
  const sentAt = row["sent_at"] as Date | null;
  const decidedAt = row["decided_at"] as Date | null;
  return {
    ...summaryOf(row, today),
    transport:
      row["transport_id"] === null
        ? null
        : {
            id: row["transport_id"] as string,
            reference: `LL-${String(Number(row["transport_number"])).padStart(6, "0")}`,
          },
    allowedStatuses: [...nextQuoteStatuses(status)],
    editable: isQuoteEditable(status),
    terms: row["terms"] as string | null,
    notes: row["notes"] as string | null,
    sentAt: sentAt ? sentAt.toISOString() : null,
    decidedAt: decidedAt ? decidedAt.toISOString() : null,
    createdBy: {
      id: row["created_by_user_id"] as string,
      displayName: row["display_name"] as string,
    },
    calculation: {
      id: row["calculation_id"] as string,
      costCents: Number(row["cost_cents"]),
      contributionCents: Number(row["contribution_cents"]),
      markupBp: row["markup_bp"] as number | null,
      marginBp: row["margin_bp"] as number | null,
    },
  };
}

/**
 * Quotes (CALCULATE pillar): an offer of one frozen calculation's price to a customer. The price is
 * copied when the quote is created. Status changes follow packages/shared quote-status.ts.
 */
export class QuoteService {
  constructor(private readonly pool: pg.Pool) {}

  async create(context: QuoteContext, input: CreateQuoteInput): Promise<QuoteDetail> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const today = await this.today(client);
      if (input.validUntil < today) {
        throw new ValidationFailedError([
          { path: "validUntil", message: "must not be in the past", code: "invalid_value" },
        ]);
      }
      const calculation = await client.query<Row>(
        "SELECT price_cents, customer_id FROM calculation WHERE id = $1",
        [input.calculationId],
      );
      const calc = calculation.rows[0];
      if (!calc) {
        throw new ValidationFailedError([
          { path: "calculationId", message: "not found", code: "invalid_reference" },
        ]);
      }
      const calcCustomer = calc["customer_id"] as string | null;
      const customerId = input.customerId ?? calcCustomer;
      if (!customerId) {
        throw new ValidationFailedError([
          {
            path: "customerId",
            message: "the calculation has no customer, so choose one for the quote",
            code: "required",
          },
        ]);
      }
      if (calcCustomer && input.customerId && input.customerId !== calcCustomer) {
        throw new ValidationFailedError([
          {
            path: "customerId",
            message: "must match the customer of the calculation",
            code: "invalid_reference",
          },
        ]);
      }
      const customer = await client.query(
        "SELECT 1 FROM customer WHERE id = $1 AND archived_at IS NULL",
        [customerId],
      );
      if (customer.rowCount === 0) {
        throw new ValidationFailedError([
          { path: "customerId", message: "not found or archived", code: "invalid_reference" },
        ]);
      }
      // The row lock on the counter makes parallel creations wait, so numbers are gapless.
      const counter = await client.query<{ last_number: number }>(
        `INSERT INTO quote_counter (organization_id, last_number) VALUES ($1, 1)
         ON CONFLICT (organization_id) DO UPDATE SET last_number = quote_counter.last_number + 1
         RETURNING last_number`,
        [context.organizationId],
      );
      const inserted = await client.query<Row>(
        `INSERT INTO quote (organization_id, number, calculation_id, customer_id, price_cents, valid_until, terms, notes, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          context.organizationId,
          counter.rows[0]?.last_number ?? 1,
          input.calculationId,
          customerId,
          calc["price_cents"],
          input.validUntil,
          input.terms ?? null,
          input.notes ?? null,
          context.userId,
        ],
      );
      const id = (inserted.rows[0] as Row)["id"] as string;
      await this.audit(client, context, "quote.created", id, {
        calculationId: input.calculationId,
        priceCents: Number(calc["price_cents"]),
      });
      return this.load(client, id, today);
    });
  }

  async list(context: QuoteContext, query: QuoteListQuery): Promise<QuoteList> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const today = await this.today(client);
      const params: unknown[] = [];
      let where = "";
      if (query.status && query.status.length > 0) {
        params.push(query.status);
        where = `WHERE q.status = ANY($1::quote_status[])`;
      }
      const total = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${FROM} ${where}`,
        params,
      );
      const rows = await client.query<Row>(
        `SELECT ${COLUMNS} FROM ${FROM} ${where}
         ORDER BY q.number DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.limit, query.offset],
      );
      return {
        items: rows.rows.map((row) => summaryOf(row, today)),
        page: { limit: query.limit, offset: query.offset, total: total.rows[0]?.n ?? 0 },
      };
    });
  }

  async get(context: QuoteContext, id: string): Promise<QuoteDetail> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) =>
      this.load(client, id, await this.today(client)),
    );
  }

  /** Only what the customer may see, for the PDF. Cost and margin never leave the calculation. */
  async pdfData(context: QuoteContext, id: string): Promise<QuotePdfData> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const rows = await client.query<Row>(
        `SELECT q.number, q.status, q.price_cents, q.valid_until::text AS valid_until, q.terms,
                cu.name AS customer_name, ca.name AS calculation_name, o.name AS issuer
         FROM quote q
         JOIN customer cu ON cu.id = q.customer_id AND cu.organization_id = q.organization_id
         JOIN calculation ca ON ca.id = q.calculation_id AND ca.organization_id = q.organization_id
         JOIN organization o ON o.id = q.organization_id
         WHERE q.id = $1`,
        [id],
      );
      const row = rows.rows[0];
      if (!row) throw new NotFoundException();
      await this.audit(client, context, "quote.pdf_created", id, {});
      return {
        issuer: row["issuer"] as string,
        reference: quoteReference(Number(row["number"])),
        customerName: row["customer_name"] as string,
        calculationName: row["calculation_name"] as string,
        priceCents: Number(row["price_cents"]),
        validUntil: row["valid_until"] as string,
        terms: row["terms"] as string | null,
        status: row["status"] as string,
      };
    });
  }

  async update(context: QuoteContext, id: string, patch: UpdateQuoteInput): Promise<QuoteDetail> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const today = await this.today(client);
      const current = await client.query<Row>("SELECT status FROM quote WHERE id = $1 FOR UPDATE", [
        id,
      ]);
      const status = current.rows[0]?.["status"] as QuoteStatus | undefined;
      if (!status) throw new NotFoundException();
      if (!isQuoteEditable(status)) {
        throw new ConflictException({
          statusCode: 409,
          code: "quote_not_editable",
          message: "Only a draft quote can be edited. A sent quote is what the customer saw.",
        });
      }
      if (patch.validUntil !== undefined && patch.validUntil < today) {
        throw new ValidationFailedError([
          { path: "validUntil", message: "must not be in the past", code: "invalid_value" },
        ]);
      }
      await client.query(
        `UPDATE quote SET
           valid_until = COALESCE($2::date, valid_until),
           terms = CASE WHEN $3::boolean THEN $4 ELSE terms END,
           notes = CASE WHEN $5::boolean THEN $6 ELSE notes END
         WHERE id = $1`,
        [
          id,
          patch.validUntil ?? null,
          patch.terms !== undefined,
          patch.terms ?? null,
          patch.notes !== undefined,
          patch.notes ?? null,
        ],
      );
      await this.audit(client, context, "quote.updated", id, {
        fields: Object.keys(patch).filter(
          (key) => patch[key as keyof UpdateQuoteInput] !== undefined,
        ),
      });
      return this.load(client, id, today);
    });
  }

  async changeStatus(context: QuoteContext, id: string, to: QuoteStatus): Promise<QuoteDetail> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const today = await this.today(client);
      const current = await client.query<Row>(
        "SELECT status, valid_until::text AS valid_until FROM quote WHERE id = $1 FOR UPDATE",
        [id],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundException();
      const from = row["status"] as QuoteStatus;
      if (!canQuoteTransition(from, to)) {
        throw new ConflictException({
          statusCode: 409,
          code: "invalid_transition",
          message: `A quote cannot change from ${from} to ${to}.`,
        });
      }
      if ((to === "sent" || to === "accepted") && (row["valid_until"] as string) < today) {
        throw new ConflictException({
          statusCode: 409,
          code: "quote_expired",
          message: "The validity date has passed. Edit the quote or create a new one.",
        });
      }
      await client.query(
        `UPDATE quote SET status = $2,
           sent_at = CASE WHEN $2::quote_status = 'sent' THEN now() ELSE sent_at END,
           decided_at = CASE WHEN $2::quote_status IN ('accepted', 'rejected') THEN now() ELSE decided_at END
         WHERE id = $1`,
        [id, to],
      );
      await this.audit(client, context, "quote.status_changed", id, { from, to });
      return this.load(client, id, today);
    });
  }

  private async load(client: pg.PoolClient, id: string, today: string): Promise<QuoteDetail> {
    const rows = await client.query<Row>(`SELECT ${COLUMNS} FROM ${FROM} WHERE q.id = $1`, [id]);
    if (!rows.rows[0]) throw new NotFoundException();
    return detailOf(rows.rows[0], today);
  }

  /** Today's date in the organization's time zone, as YYYY-MM-DD. */
  private async today(client: pg.PoolClient): Promise<string> {
    const result = await client.query<{ today: string }>(
      "SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM organization LIMIT 1",
    );
    return result.rows[0]?.today ?? new Date().toISOString().slice(0, 10);
  }

  private tenant(context: QuoteContext) {
    return { organizationId: context.organizationId, userId: context.userId };
  }

  private async audit(
    client: pg.PoolClient,
    context: QuoteContext,
    action: string,
    entityId: string,
    changes: unknown,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (organization_id, actor_type, actor_user_id, action, entity_type, entity_id, changes, request_id)
       VALUES ($1, 'user', $2, $3, 'quote', $4, $5, $6)`,
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
