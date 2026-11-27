import { withTenant } from "@loadlane/db";
import { localTimeToIso, parseLocalDateTime } from "@loadlane/shared";
import type pg from "pg";
import { CsvError, parseCsv } from "../../platform/csv.ts";
import type { CreateTransportInput } from "./transport.schemas.ts";
import {
  transportReference,
  type TransportContext,
  type TransportService,
} from "./transport-service.ts";

export const IMPORT_MAX_ROWS = 200;

/** The columns of the import file. Matching ignores case, spaces and underscores. */
export const IMPORT_COLUMNS = [
  "customer",
  "customer_reference",
  "purchase_order",
  "weight_lb",
  "pieces",
  "carrier",
  "pickup_location",
  "pickup_start",
  "pickup_end",
  "delivery_location",
  "delivery_start",
  "delivery_end",
  "notes",
] as const;

const REQUIRED = [
  "customer",
  "pickup_location",
  "pickup_start",
  "pickup_end",
  "delivery_location",
  "delivery_start",
  "delivery_end",
] as const;

type Column = (typeof IMPORT_COLUMNS)[number];

export interface ImportRowReport {
  /** Line of the file the row starts on. */
  line: number;
  problems: string[];
}

export interface ImportReport {
  /** `preview`: nothing was written. `imported`: every row was created. `rejected`: a row has problems, nothing was written. */
  status: "preview" | "imported" | "rejected";
  /** Problems with the file as a whole (missing columns, too many rows). */
  fileProblems: string[];
  rows: ImportRowReport[];
  summary: { total: number; valid: number; failed: number };
  /** References of the transports created, in file order. */
  created: string[];
}

function normalize(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function key(name: string): string {
  return name.trim().toLowerCase();
}

type NameIndex = Map<string, { id: string; timezone?: string }[]>;

function indexByName(rows: { id: string; name: string; timezone?: string }[]): NameIndex {
  const index: NameIndex = new Map();
  for (const row of rows) {
    const entries = index.get(key(row.name)) ?? [];
    entries.push(
      row.timezone === undefined ? { id: row.id } : { id: row.id, timezone: row.timezone },
    );
    index.set(key(row.name), entries);
  }
  return index;
}

/**
 * Imports transports from a CSV file, all or nothing (P2-06). Customers, carriers and locations are
 * matched by name against the active records of the organization; nothing is created on the side.
 * A row that repeats a customer reference of the same customer, in the file or among existing
 * transports, is reported and blocks the import. With `dryRun` nothing is written.
 */
export class TransportImporter {
  constructor(
    private readonly pool: pg.Pool,
    private readonly service: TransportService,
  ) {}

  async run(context: TransportContext, csv: string, dryRun: boolean): Promise<ImportReport> {
    let table;
    try {
      table = parseCsv(csv);
    } catch (error) {
      if (error instanceof CsvError) {
        return this.failed([
          `The file cannot be read as CSV (line ${error.line}): ${error.message}.`,
        ]);
      }
      throw error;
    }
    const [header, ...dataRows] = table;
    if (!header) return this.failed(["The file is empty."]);

    const fileProblems: string[] = [];
    const columns = new Map<Column, number>();
    for (const [position, name] of header.fields.entries()) {
      const column = IMPORT_COLUMNS.find((candidate) => candidate === normalize(name));
      if (!column) fileProblems.push(`Unknown column "${name.trim()}".`);
      else if (columns.has(column)) fileProblems.push(`The column "${column}" appears twice.`);
      else columns.set(column, position);
    }
    for (const required of REQUIRED) {
      if (!columns.has(required)) fileProblems.push(`The column "${required}" is missing.`);
    }
    if (dataRows.length === 0) fileProblems.push("The file has no rows below the header.");
    if (dataRows.length > IMPORT_MAX_ROWS) {
      fileProblems.push(
        `The file has ${dataRows.length} rows. Import at most ${IMPORT_MAX_ROWS} at a time.`,
      );
    }
    if (fileProblems.length > 0) return this.failed(fileProblems);

    return withTenant(
      this.pool,
      { organizationId: context.organizationId, userId: context.userId },
      async ({ client }) => {
        const [customers, carriers, locations] = await Promise.all([
          client.query<{ id: string; name: string }>(
            "SELECT id, name FROM customer WHERE archived_at IS NULL",
          ),
          client.query<{ id: string; name: string }>(
            "SELECT id, name FROM carrier WHERE archived_at IS NULL",
          ),
          client.query<{ id: string; name: string; timezone: string }>(
            "SELECT id, name, timezone FROM location WHERE archived_at IS NULL",
          ),
        ]);
        const customerIndex = indexByName(customers.rows);
        const carrierIndex = indexByName(carriers.rows);
        const locationIndex = indexByName(locations.rows);

        const rows: ImportRowReport[] = [];
        const inputs: (CreateTransportInput | undefined)[] = [];
        const seenReferences = new Map<string, number>();
        const referenceChecks: { customerId: string; reference: string; row: number }[] = [];

        for (const dataRow of dataRows) {
          const problems: string[] = [];
          const cell = (column: Column): string => {
            const position = columns.get(column);
            return position === undefined ? "" : (dataRow.fields[position] ?? "").trim();
          };
          if (dataRow.fields.length > header.fields.length) {
            problems.push("The row has more fields than the header has columns.");
          }

          const lookup = (index: NameIndex, column: Column, what: string) => {
            const name = cell(column);
            if (name === "") return undefined;
            const found = index.get(key(name));
            if (!found || found.length === 0) {
              problems.push(`${what} "${name}" was not found among the active records.`);
              return undefined;
            }
            if (found.length > 1) {
              problems.push(
                `${what} "${name}" matches ${found.length} records. Give them different names first.`,
              );
              return undefined;
            }
            return found[0];
          };

          const customer =
            cell("customer") === "" ? undefined : lookup(customerIndex, "customer", "Customer");
          if (cell("customer") === "") problems.push("The customer is missing.");
          const carrier = lookup(carrierIndex, "carrier", "Carrier");
          const pickup =
            cell("pickup_location") === ""
              ? undefined
              : lookup(locationIndex, "pickup_location", "Pickup location");
          if (cell("pickup_location") === "") problems.push("The pickup location is missing.");
          const delivery =
            cell("delivery_location") === ""
              ? undefined
              : lookup(locationIndex, "delivery_location", "Delivery location");
          if (cell("delivery_location") === "") problems.push("The delivery location is missing.");

          const window = (
            location: { timezone?: string } | undefined,
            start: Column,
            end: Column,
            label: string,
          ) => {
            if (!location?.timezone) return undefined;
            const localStart = parseLocalDateTime(cell(start));
            const localEnd = parseLocalDateTime(cell(end));
            if (!localStart)
              problems.push(
                `${label} start "${cell(start)}" is not a date and time (use 2026-12-01 14:30 or 12/01/2026 2:30 PM).`,
              );
            if (!localEnd)
              problems.push(
                `${label} end "${cell(end)}" is not a date and time (use 2026-12-01 14:30 or 12/01/2026 2:30 PM).`,
              );
            if (!localStart || !localEnd) return undefined;
            const windowStart = localTimeToIso(localStart, location.timezone);
            const windowEnd = localTimeToIso(localEnd, location.timezone);
            if (!windowStart || !windowEnd) return undefined;
            if (new Date(windowEnd) < new Date(windowStart)) {
              problems.push(`${label} window ends before it starts.`);
              return undefined;
            }
            return { windowStart, windowEnd };
          };
          const pickupWindow = window(pickup, "pickup_start", "pickup_end", "Pickup");
          const deliveryWindow = window(delivery, "delivery_start", "delivery_end", "Delivery");

          let weightLb: number | null = null;
          if (cell("weight_lb") !== "") {
            weightLb = Number(cell("weight_lb").replaceAll(",", ""));
            if (!Number.isFinite(weightLb) || weightLb <= 0 || weightLb > 1_000_000) {
              problems.push(
                `Weight "${cell("weight_lb")}" is not a number of pounds greater than 0.`,
              );
            }
          }
          let pieces: number | null = null;
          if (cell("pieces") !== "") {
            pieces = Number(cell("pieces"));
            if (!Number.isInteger(pieces) || pieces <= 0 || pieces > 1_000_000) {
              problems.push(`Pieces "${cell("pieces")}" is not a whole number greater than 0.`);
            }
          }
          for (const [column, max] of [
            ["customer_reference", 80],
            ["purchase_order", 80],
            ["notes", 2000],
          ] as const) {
            if (cell(column).length > max)
              problems.push(`The column "${column}" is longer than ${max} characters.`);
          }

          const reference = cell("customer_reference");
          if (customer && reference !== "") {
            const duplicateKey = `${customer.id}|${key(reference)}`;
            const earlier = seenReferences.get(duplicateKey);
            if (earlier !== undefined) {
              problems.push(
                `The customer reference "${reference}" already appears on line ${earlier}.`,
              );
            } else {
              seenReferences.set(duplicateKey, dataRow.line);
              referenceChecks.push({ customerId: customer.id, reference, row: rows.length });
            }
          }

          rows.push({ line: dataRow.line, problems });
          inputs.push(
            problems.length === 0 &&
              customer &&
              pickup &&
              delivery &&
              pickupWindow &&
              deliveryWindow
              ? {
                  customerId: customer.id,
                  carrierId: carrier?.id ?? null,
                  customerReference: reference === "" ? null : reference,
                  purchaseOrder: cell("purchase_order") === "" ? null : cell("purchase_order"),
                  weightLb,
                  pieces,
                  notes: cell("notes") === "" ? null : cell("notes"),
                  stops: [
                    { type: "pickup", locationId: pickup.id, ...pickupWindow },
                    { type: "delivery", locationId: delivery.id, ...deliveryWindow },
                  ],
                }
              : undefined,
          );
        }

        // Customer references that already belong to a transport of the same customer.
        if (referenceChecks.length > 0) {
          const existing = await client.query<{
            customer_id: string;
            reference: string;
            number: number;
          }>(
            `SELECT customer_id, lower(customer_reference) AS reference, number FROM transport
             WHERE status <> 'cancelled'
               AND (customer_id, lower(customer_reference)) IN (SELECT * FROM unnest($1::uuid[], $2::text[]))`,
            [
              referenceChecks.map((check) => check.customerId),
              referenceChecks.map((check) => key(check.reference)),
            ],
          );
          for (const hit of existing.rows) {
            const check = referenceChecks.find(
              (candidate) =>
                candidate.customerId === hit.customer_id &&
                key(candidate.reference) === hit.reference,
            );
            const row = check === undefined ? undefined : rows[check.row];
            if (row && check) {
              row.problems.push(
                `The customer reference "${check.reference}" already exists on ${transportReference(hit.number)}.`,
              );
              inputs[check.row] = undefined;
            }
          }
        }

        const failed = rows.filter((row) => row.problems.length > 0).length;
        const summary = { total: rows.length, valid: rows.length - failed, failed };
        if (dryRun) return { status: "preview", fileProblems: [], rows, summary, created: [] };
        if (failed > 0) return { status: "rejected", fileProblems: [], rows, summary, created: [] };

        const created: string[] = [];
        for (const input of inputs) {
          if (!input) continue;
          created.push((await this.service.createWithin(client, context, input)).reference);
        }
        await client.query(
          `INSERT INTO audit_log (organization_id, actor_type, actor_user_id, action, entity_type, changes, request_id)
           VALUES ($1, 'user', $2, 'transport.imported', 'transport', $3, $4)`,
          [
            context.organizationId,
            context.userId,
            JSON.stringify({ count: created.length }),
            context.requestId ?? null,
          ],
        );
        return { status: "imported", fileProblems: [], rows, summary, created };
      },
    );
  }

  private failed(fileProblems: string[]): ImportReport {
    return {
      status: "rejected",
      fileProblems,
      rows: [],
      summary: { total: 0, valid: 0, failed: 0 },
      created: [],
    };
  }
}
