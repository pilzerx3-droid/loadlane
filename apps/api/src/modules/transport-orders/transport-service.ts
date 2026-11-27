import { ConflictException, NotFoundException } from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import {
  canTransition,
  nextTransportStatuses,
  STATUSES_REQUIRING_CARRIER,
  type TransportStatus,
} from "@loadlane/shared";
import type pg from "pg";
import { ValidationFailedError, type FieldError } from "../../platform/validation.ts";
import type {
  CreateTransportInput,
  TransportDetail,
  TransportListQuery,
  TransportListResponse,
  UpdateTransportInput,
} from "./transport.schemas.ts";

export interface TransportContext {
  organizationId: string;
  userId: string;
  requestId?: string | undefined;
}

/** Statuses in which fields and stops may still be changed: before the freight is on the road. */
const EDITABLE_STATUSES: readonly TransportStatus[] = [
  "created",
  "planned",
  "assigned",
  "confirmed",
];

export function transportReference(number: number): string {
  return `LL-${String(number).padStart(6, "0")}`;
}

/** "LL-12", "ll12" and "12" all mean transport number 12. */
export function parseTransportNumber(text: string): number | undefined {
  const match = /^(?:ll-?)?(\d{1,9})$/i.exec(text.trim());
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

type Row = Record<string, unknown>;

const LIST_FROM = `
  FROM transport t
  JOIN customer c ON c.id = t.customer_id
  LEFT JOIN carrier ca ON ca.id = t.carrier_id
  JOIN stop o ON o.transport_id = t.id AND o.sequence = 1
  JOIN LATERAL (SELECT * FROM stop WHERE transport_id = t.id ORDER BY sequence DESC LIMIT 1) d ON true
  JOIN location ol ON ol.id = o.location_id
  JOIN location dl ON dl.id = d.location_id`;

/**
 * Transports with their stops and history (ADR 0014). Every method runs in one transaction under
 * row-level security. Status changes and edits write an audit entry; status changes also write the
 * immutable event.
 */
export class TransportService {
  constructor(private readonly pool: pg.Pool) {}

  async list(context: TransportContext, query: TransportListQuery): Promise<TransportListResponse> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      conditions.push(sql.replace("?", `$${params.length}`));
    };
    if (query.status && query.status.length > 0)
      add("t.status = ANY(?::transport_status[])", query.status);
    if (query.customerId) add("t.customer_id = ?", query.customerId);
    if (query.carrierId) add("t.carrier_id = ?", query.carrierId);
    if (query.pickupFrom) add("o.window_start >= ?", query.pickupFrom);
    if (query.pickupTo) add("o.window_start < ?", query.pickupTo);
    if (query.q) {
      const number = parseTransportNumber(query.q);
      params.push(likePattern(query.q));
      const text = `(t.customer_reference ILIKE $${params.length} OR t.purchase_order ILIKE $${params.length} OR c.name ILIKE $${params.length} OR ca.name ILIKE $${params.length})`;
      if (number === undefined) conditions.push(text);
      else {
        params.push(number);
        conditions.push(`(${text} OR t.number = $${params.length})`);
      }
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const total = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n ${LIST_FROM} ${where}`,
        params,
      );
      const rows = await client.query<Row>(
        `SELECT t.id, t.number, t.status, t.customer_reference, t.purchase_order, t.created_at,
                c.id AS customer_id, c.name AS customer_name, ca.id AS carrier_id, ca.name AS carrier_name,
                ol.city AS origin_city, ol.state AS origin_state, ol.timezone AS origin_timezone, o.window_start AS origin_start,
                dl.city AS destination_city, dl.state AS destination_state, dl.timezone AS destination_timezone, d.window_start AS destination_start
         ${LIST_FROM} ${where}
         ORDER BY t.number DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.limit, query.offset],
      );
      return {
        items: rows.rows.map((row) => ({
          id: row["id"] as string,
          number: row["number"] as number,
          reference: transportReference(row["number"] as number),
          status: row["status"] as TransportStatus,
          customer: { id: row["customer_id"] as string, name: row["customer_name"] as string },
          carrier:
            row["carrier_id"] === null
              ? null
              : { id: row["carrier_id"] as string, name: row["carrier_name"] as string },
          customerReference: row["customer_reference"] as string | null,
          purchaseOrder: row["purchase_order"] as string | null,
          origin: {
            city: row["origin_city"] as string,
            state: row["origin_state"] as string,
            timezone: row["origin_timezone"] as string,
            windowStart: (row["origin_start"] as Date).toISOString(),
          },
          destination: {
            city: row["destination_city"] as string,
            state: row["destination_state"] as string,
            timezone: row["destination_timezone"] as string,
            windowStart: (row["destination_start"] as Date).toISOString(),
          },
          createdAt: (row["created_at"] as Date).toISOString(),
        })),
        page: { limit: query.limit, offset: query.offset, total: total.rows[0]?.n ?? 0 },
      };
    });
  }

  async get(context: TransportContext, id: string): Promise<TransportDetail> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const detail = await this.load(client, id);
      if (!detail) throw new NotFoundException();
      return detail;
    });
  }

  async create(context: TransportContext, input: CreateTransportInput): Promise<TransportDetail> {
    return withTenant(this.pool, this.tenant(context), ({ client }) =>
      this.createWithin(client, context, input),
    );
  }

  /** Creates a transport inside a transaction the caller already opened (the CSV import creates many in one). */
  async createWithin(
    client: pg.PoolClient,
    context: TransportContext,
    input: CreateTransportInput,
  ): Promise<TransportDetail> {
    {
      await this.checkReferences(client, input.customerId, input.carrierId, input.stops);

      // Take the next number. The row lock makes parallel creations wait, so numbers are gapless per organization.
      const counter = await client.query<{ last_number: number }>(
        `INSERT INTO transport_counter (organization_id, last_number) VALUES ($1, 1)
         ON CONFLICT (organization_id) DO UPDATE SET last_number = transport_counter.last_number + 1
         RETURNING last_number`,
        [context.organizationId],
      );
      const number = counter.rows[0]?.last_number ?? 1;

      const created = await client.query<{ id: string }>(
        `INSERT INTO transport (organization_id, number, customer_id, carrier_id, customer_reference, purchase_order, weight_lb, pieces, notes, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          context.organizationId,
          number,
          input.customerId,
          input.carrierId ?? null,
          input.customerReference ?? null,
          input.purchaseOrder ?? null,
          input.weightLb ?? null,
          input.pieces ?? null,
          input.notes ?? null,
          context.userId,
        ],
      );
      const id = created.rows[0]?.id ?? "";
      await this.insertStops(client, context, id, input.stops);
      await client.query(
        `INSERT INTO transport_event (organization_id, transport_id, source, actor_user_id, from_status, to_status)
         VALUES ($1, $2, 'user', $3, NULL, 'created')`,
        [context.organizationId, id, context.userId],
      );
      await this.audit(client, context, "transport.created", id, {
        number,
        customerId: input.customerId,
        carrierId: input.carrierId ?? null,
        stops: input.stops.length,
      });
      const detail = await this.load(client, id);
      if (!detail) throw new NotFoundException();
      return detail;
    }
  }

  async update(
    context: TransportContext,
    id: string,
    patch: UpdateTransportInput,
  ): Promise<TransportDetail> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const current = await client.query<Row>(
        "SELECT status, carrier_id, customer_id FROM transport WHERE id = $1 FOR UPDATE",
        [id],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundException();
      const status = row["status"] as TransportStatus;
      if (!EDITABLE_STATUSES.includes(status)) {
        throw new ConflictException({
          statusCode: 409,
          code: "transport_not_editable",
          message: `A transport that is ${status.replace("_", " ")} can no longer be edited.`,
        });
      }
      const carrierId =
        patch.carrierId === undefined ? (row["carrier_id"] as string | null) : patch.carrierId;
      if (carrierId === null && STATUSES_REQUIRING_CARRIER.includes(status)) {
        throw new ConflictException({
          statusCode: 409,
          code: "carrier_required",
          message: `A transport that is ${status} needs a carrier.`,
        });
      }
      await this.checkReferences(
        client,
        patch.customerId,
        patch.carrierId ?? undefined,
        patch.stops,
      );

      const columns: [string, unknown][] = [];
      if (patch.customerId !== undefined) columns.push(["customer_id", patch.customerId]);
      if (patch.carrierId !== undefined) columns.push(["carrier_id", patch.carrierId]);
      if (patch.customerReference !== undefined)
        columns.push(["customer_reference", patch.customerReference]);
      if (patch.purchaseOrder !== undefined) columns.push(["purchase_order", patch.purchaseOrder]);
      if (patch.weightLb !== undefined) columns.push(["weight_lb", patch.weightLb]);
      if (patch.pieces !== undefined) columns.push(["pieces", patch.pieces]);
      if (patch.notes !== undefined) columns.push(["notes", patch.notes]);
      if (columns.length > 0) {
        await client.query(
          `UPDATE transport SET ${columns.map(([name], index) => `${name} = $${index + 2}`).join(", ")} WHERE id = $1`,
          [id, ...columns.map(([, value]) => value)],
        );
      } else if (patch.stops) {
        await client.query("UPDATE transport SET updated_at = now() WHERE id = $1", [id]);
      }
      if (patch.stops) {
        await client.query("DELETE FROM stop WHERE transport_id = $1", [id]);
        await this.insertStops(client, context, id, patch.stops);
      }
      if (columns.length > 0 || patch.stops) {
        await this.audit(client, context, "transport.updated", id, {
          fields: columns.map(([name]) => name),
          stopsReplaced: patch.stops !== undefined,
        });
      }
      const detail = await this.load(client, id);
      if (!detail) throw new NotFoundException();
      return detail;
    });
  }

  async changeStatus(
    context: TransportContext,
    id: string,
    to: TransportStatus,
    note: string | null | undefined,
  ): Promise<TransportDetail> {
    return withTenant(this.pool, this.tenant(context), async ({ client }) => {
      const current = await client.query<Row>(
        "SELECT status, carrier_id FROM transport WHERE id = $1 FOR UPDATE",
        [id],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundException();
      const from = row["status"] as TransportStatus;
      if (!canTransition(from, to)) {
        throw new ConflictException({
          statusCode: 409,
          code: "invalid_transition",
          message: `A transport cannot change from ${from} to ${to}.`,
        });
      }
      if (row["carrier_id"] === null && STATUSES_REQUIRING_CARRIER.includes(to)) {
        throw new ConflictException({
          statusCode: 409,
          code: "carrier_required",
          message: "Assign a carrier before moving the transport to this status.",
        });
      }
      await client.query("UPDATE transport SET status = $2 WHERE id = $1", [id, to]);
      await client.query(
        `INSERT INTO transport_event (organization_id, transport_id, source, actor_user_id, from_status, to_status, note)
         VALUES ($1, $2, 'user', $3, $4, $5, $6)`,
        [context.organizationId, id, context.userId, from, to, note ?? null],
      );
      await this.audit(client, context, "transport.status_changed", id, { from, to });
      const detail = await this.load(client, id);
      if (!detail) throw new NotFoundException();
      return detail;
    });
  }

  private tenant(context: TransportContext) {
    return { organizationId: context.organizationId, userId: context.userId };
  }

  /** Customer, carrier and locations must exist in this organization and not be archived. */
  private async checkReferences(
    client: pg.PoolClient,
    customerId: string | undefined,
    carrierId: string | null | undefined,
    stops: readonly { locationId: string }[] | undefined,
  ): Promise<void> {
    const errors: FieldError[] = [];
    const missing = (path: string): void => {
      errors.push({ path, message: "not found or archived", code: "invalid_reference" });
    };
    const exists = async (table: string, id: string): Promise<boolean> => {
      const result = await client.query(
        `SELECT 1 FROM "${table}" WHERE id = $1 AND archived_at IS NULL`,
        [id],
      );
      return (result.rowCount ?? 0) > 0;
    };
    if (customerId && !(await exists("customer", customerId))) missing("customerId");
    if (carrierId && !(await exists("carrier", carrierId))) missing("carrierId");
    for (const [index, stop] of (stops ?? []).entries()) {
      if (!(await exists("location", stop.locationId))) missing(`stops.${index}.locationId`);
    }
    if (errors.length > 0) throw new ValidationFailedError(errors);
  }

  private async insertStops(
    client: pg.PoolClient,
    context: TransportContext,
    transportId: string,
    stops: CreateTransportInput["stops"],
  ): Promise<void> {
    for (const [index, stop] of stops.entries()) {
      await client.query(
        `INSERT INTO stop (organization_id, transport_id, sequence, type, location_id, window_start, window_end, reference, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          context.organizationId,
          transportId,
          index + 1,
          stop.type,
          stop.locationId,
          stop.windowStart,
          stop.windowEnd,
          stop.reference ?? null,
          stop.notes ?? null,
        ],
      );
    }
  }

  private async load(client: pg.PoolClient, id: string): Promise<TransportDetail | undefined> {
    const transport = await client.query<Row>(
      `SELECT t.*, c.name AS customer_name, ca.name AS carrier_name
       FROM transport t
       JOIN customer c ON c.id = t.customer_id
       LEFT JOIN carrier ca ON ca.id = t.carrier_id
       WHERE t.id = $1`,
      [id],
    );
    const row = transport.rows[0];
    if (!row) return undefined;
    const stops = await client.query<Row>(
      `SELECT s.id, s.sequence, s.type, s.window_start, s.window_end, s.reference, s.notes,
              l.id AS location_id, l.name AS location_name, l.address_line1, l.address_line2, l.city, l.state, l.postal_code, l.timezone
       FROM stop s JOIN location l ON l.id = s.location_id
       WHERE s.transport_id = $1 ORDER BY s.sequence`,
      [id],
    );
    const events = await client.query<Row>(
      `SELECT e.id, e.occurred_at, e.source, e.actor_user_id, u.display_name, e.from_status, e.to_status, e.note
       FROM transport_event e LEFT JOIN app_user u ON u.id = e.actor_user_id
       WHERE e.transport_id = $1 ORDER BY e.occurred_at DESC, e.id DESC`,
      [id],
    );
    const status = row["status"] as TransportStatus;
    return {
      id: row["id"] as string,
      number: row["number"] as number,
      reference: transportReference(row["number"] as number),
      status,
      allowedStatuses: [...nextTransportStatuses(status)],
      editable: EDITABLE_STATUSES.includes(status),
      customer: { id: row["customer_id"] as string, name: row["customer_name"] as string },
      carrier:
        row["carrier_id"] === null
          ? null
          : { id: row["carrier_id"] as string, name: row["carrier_name"] as string },
      customerReference: row["customer_reference"] as string | null,
      purchaseOrder: row["purchase_order"] as string | null,
      weightLb: row["weight_lb"] === null ? null : Number(row["weight_lb"]),
      pieces: row["pieces"] as number | null,
      notes: row["notes"] as string | null,
      createdAt: (row["created_at"] as Date).toISOString(),
      updatedAt: (row["updated_at"] as Date).toISOString(),
      stops: stops.rows.map((stop) => ({
        id: stop["id"] as string,
        sequence: stop["sequence"] as number,
        type: stop["type"] as "pickup" | "delivery",
        location: {
          id: stop["location_id"] as string,
          name: stop["location_name"] as string,
          addressLine1: stop["address_line1"] as string,
          addressLine2: stop["address_line2"] as string | null,
          city: stop["city"] as string,
          state: stop["state"] as string,
          postalCode: stop["postal_code"] as string,
          timezone: stop["timezone"] as string,
        },
        windowStart: (stop["window_start"] as Date).toISOString(),
        windowEnd: (stop["window_end"] as Date).toISOString(),
        reference: stop["reference"] as string | null,
        notes: stop["notes"] as string | null,
      })),
      events: events.rows.map((event) => ({
        id: event["id"] as string,
        occurredAt: (event["occurred_at"] as Date).toISOString(),
        source: event["source"] as "user" | "driver" | "integration" | "system",
        actor:
          event["actor_user_id"] === null
            ? null
            : {
                id: event["actor_user_id"] as string,
                displayName: event["display_name"] as string,
              },
        fromStatus: event["from_status"] as TransportStatus | null,
        toStatus: event["to_status"] as TransportStatus,
        note: event["note"] as string | null,
      })),
    };
  }

  private async audit(
    client: pg.PoolClient,
    context: TransportContext,
    action: string,
    entityId: string,
    changes: unknown,
  ): Promise<void> {
    // OPEN (legal, ADR 0002): ip and user agent are not recorded until their retention is decided.
    await client.query(
      `INSERT INTO audit_log (organization_id, actor_type, actor_user_id, action, entity_type, entity_id, changes, request_id)
       VALUES ($1, 'user', $2, $3, 'transport', $4, $5, $6)`,
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
