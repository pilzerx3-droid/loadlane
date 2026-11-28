import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from "@nestjs/common";
import { withTenant } from "@loadlane/db";
import {
  CONSENT_TEXT_VERSION,
  DRIVER_REPORTABLE_STATUSES,
  STATUSES_REQUIRING_CARRIER,
  canTransition,
  checkPosition,
  type TransportStatus,
} from "@loadlane/shared";
import type pg from "pg";
import { ValidationFailedError } from "../../platform/validation.ts";
import { hashDriverToken } from "./driver-link-service.ts";

/** What a driver link resolves to. The organization comes from the link, never from the request. */
export interface DriverGrant {
  linkId: string;
  organizationId: string;
  transportId: string;
}

export interface DriverJob {
  reference: string;
  status: TransportStatus;
  /** Statuses this driver may report next. Empty when the transport is closed. */
  nextStatuses: string[];
  /** Whether positions are accepted right now (consent given, not withdrawn, transport open). */
  sharing: boolean;
  consent: { acceptedAt: string; withdrawnAt: string | null } | null;
  consentTextVersion: number;
  stops: {
    sequence: number;
    type: "pickup" | "delivery";
    windowStart: string;
    windowEnd: string;
    reference: string | null;
    notes: string | null;
    location: {
      name: string;
      addressLine1: string;
      addressLine2: string | null;
      city: string;
      state: string;
      postalCode: string;
      timezone: string;
    };
  }[];
}

export interface PositionReport {
  latitude: number;
  longitude: number;
  accuracyM?: number | null | undefined;
  recordedAt: Date;
}

type Row = Record<string, unknown>;

/** Statuses after which no more positions are accepted. */
const TRACKING_CLOSED: readonly string[] = ["delivered", "completed", "cancelled"];

function formatReference(number: number): string {
  return `LL-${String(number).padStart(6, "0")}`;
}

/**
 * Everything a driver can do through a Driver Link (ADR 0015): see the job, decide about sharing a
 * position, report a status, send positions. The link is the only credential. Each call resolves it
 * first, then runs inside the link's organization under row-level security.
 */
export class DriverAccessService {
  constructor(
    private readonly pool: pg.Pool,
    /** Called after a position was stored (not awaited): used to refresh the estimated arrival. */
    private readonly onPositionStored: (organizationId: string, transportId: string) => void = () =>
      undefined,
  ) {}

  /** Finds the link by the hash of the presented token. Unknown tokens, expired and revoked links each get their own answer. */
  async resolve(token: unknown): Promise<DriverGrant> {
    if (typeof token !== "string" || token.length < 20 || token.length > 200) {
      throw this.invalid();
    }
    const row = await withTenant(
      this.pool,
      { driverTokenHash: hashDriverToken(token) },
      async ({ client }) => {
        const result = await client.query<Row>(
          "SELECT id, organization_id, transport_id, expires_at <= now() AS expired, revoked_at FROM driver_link",
        );
        return result.rows[0];
      },
    );
    if (!row) throw this.invalid();
    if (row["revoked_at"]) {
      throw new GoneException({
        statusCode: 410,
        code: "driver_link_revoked",
        message: "This link was withdrawn. Ask the dispatcher for a new one.",
      });
    }
    if (row["expired"] === true) {
      throw new GoneException({
        statusCode: 410,
        code: "driver_link_expired",
        message: "This link has expired. Ask the dispatcher for a new one.",
      });
    }
    return {
      linkId: row["id"] as string,
      organizationId: row["organization_id"] as string,
      transportId: row["transport_id"] as string,
    };
  }

  async job(token: unknown): Promise<DriverJob> {
    const grant = await this.resolve(token);
    return withTenant(this.pool, { organizationId: grant.organizationId }, ({ client }) =>
      this.loadJob(client, grant),
    );
  }

  /** Records that the driver saw the current text and agreed. Repeating it changes nothing. */
  async acceptConsent(token: unknown, textVersion: number): Promise<DriverJob> {
    const grant = await this.resolve(token);
    if (textVersion !== CONSENT_TEXT_VERSION) {
      throw new ConflictException({
        statusCode: 409,
        code: "consent_text_outdated",
        message: "The consent text changed. Reload the page and read it again.",
      });
    }
    return withTenant(this.pool, { organizationId: grant.organizationId }, async ({ client }) => {
      const open = await this.activeConsent(client, grant);
      if (!open) {
        await client.query(
          "INSERT INTO driver_consent (organization_id, driver_link_id, text_version) VALUES ($1, $2, $3)",
          [grant.organizationId, grant.linkId, textVersion],
        );
        await this.audit(client, grant, "driver.consent_given", { textVersion });
      }
      return this.loadJob(client, grant);
    });
  }

  /** Stops sharing. The driver can agree again later on the same link. */
  async withdrawConsent(token: unknown): Promise<DriverJob> {
    const grant = await this.resolve(token);
    return withTenant(this.pool, { organizationId: grant.organizationId }, async ({ client }) => {
      const result = await client.query(
        `UPDATE driver_consent SET withdrawn_at = now()
         WHERE driver_link_id = $1 AND withdrawn_at IS NULL`,
        [grant.linkId],
      );
      if ((result.rowCount ?? 0) > 0)
        await this.audit(client, grant, "driver.consent_withdrawn", {});
      return this.loadJob(client, grant);
    });
  }

  /** A status the driver reports. The same transition rules as for dispatchers apply. */
  async reportStatus(token: unknown, status: string, note: string | null): Promise<DriverJob> {
    const grant = await this.resolve(token);
    if (!(DRIVER_REPORTABLE_STATUSES as readonly string[]).includes(status)) {
      throw new ValidationFailedError([
        {
          path: "status",
          message: `must be one of ${DRIVER_REPORTABLE_STATUSES.join(", ")}`,
          code: "invalid_value",
        },
      ]);
    }
    const to = status as TransportStatus;
    return withTenant(this.pool, { organizationId: grant.organizationId }, async ({ client }) => {
      const current = await client.query<Row>(
        "SELECT status, carrier_id FROM transport WHERE id = $1 FOR UPDATE",
        [grant.transportId],
      );
      const row = current.rows[0];
      if (!row) throw this.invalid();
      const from = row["status"] as TransportStatus;
      if (!canTransition(from, to)) {
        throw new ConflictException({
          statusCode: 409,
          code: "invalid_transition",
          message: `The transport cannot change from ${from} to ${to}.`,
        });
      }
      if (row["carrier_id"] === null && STATUSES_REQUIRING_CARRIER.includes(to)) {
        throw new ConflictException({
          statusCode: 409,
          code: "carrier_required",
          message: "The dispatcher has not assigned a carrier yet.",
        });
      }
      await client.query("UPDATE transport SET status = $2 WHERE id = $1", [grant.transportId, to]);
      await client.query(
        `INSERT INTO transport_event (organization_id, transport_id, source, from_status, to_status, note)
         VALUES ($1, $2, 'driver', $3, $4, $5)`,
        [grant.organizationId, grant.transportId, from, to, note],
      );
      await this.audit(client, grant, "driver.status_changed", { from, to });
      return this.loadJob(client, grant);
    });
  }

  /** Stores one reported position. Refused without consent or once the transport is closed. */
  async reportPosition(token: unknown, report: PositionReport, now = new Date()): Promise<void> {
    const grant = await this.resolve(token);
    const check = checkPosition(report, now);
    if (!check.ok) {
      throw new ValidationFailedError([
        { path: "position", message: check.code.replaceAll("_", " "), code: check.code },
      ]);
    }
    await withTenant(this.pool, { organizationId: grant.organizationId }, async ({ client }) => {
      const transport = await client.query<Row>("SELECT status FROM transport WHERE id = $1", [
        grant.transportId,
      ]);
      const status = transport.rows[0]?.["status"] as string | undefined;
      if (!status) throw this.invalid();
      if (!(await this.activeConsent(client, grant))) {
        throw new ForbiddenException({
          statusCode: 403,
          code: "consent_required",
          message: "The driver has not agreed to share a position.",
        });
      }
      if (TRACKING_CLOSED.includes(status)) {
        throw new ConflictException({
          statusCode: 409,
          code: "tracking_closed",
          message: "This transport is finished, so positions are no longer accepted.",
        });
      }
      const values = [
        grant.organizationId,
        grant.transportId,
        report.recordedAt,
        report.latitude,
        report.longitude,
        report.accuracyM ?? null,
        check.lowQuality,
      ];
      await client.query(
        `INSERT INTO position_event (organization_id, transport_id, driver_link_id, recorded_at, latitude, longitude, accuracy_m, low_quality)
         VALUES ($1, $2, $8, $3, $4, $5, $6, $7)`,
        [...values, grant.linkId],
      );
      // Only a newer device time replaces the last position: late or repeated reports cannot move it back.
      await client.query(
        `INSERT INTO last_position (organization_id, transport_id, recorded_at, received_at, latitude, longitude, accuracy_m, low_quality)
         VALUES ($1, $2, $3, now(), $4, $5, $6, $7)
         ON CONFLICT (transport_id) DO UPDATE SET
           recorded_at = EXCLUDED.recorded_at, received_at = EXCLUDED.received_at,
           latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
           accuracy_m = EXCLUDED.accuracy_m, low_quality = EXCLUDED.low_quality
         WHERE last_position.recorded_at < EXCLUDED.recorded_at`,
        values,
      );
    });
    this.onPositionStored(grant.organizationId, grant.transportId);
  }

  private invalid(): NotFoundException {
    return new NotFoundException({
      statusCode: 404,
      code: "driver_link_invalid",
      message: "This link is not valid.",
    });
  }

  private async activeConsent(client: pg.PoolClient, grant: DriverGrant): Promise<boolean> {
    const result = await client.query(
      "SELECT 1 FROM driver_consent WHERE driver_link_id = $1 AND withdrawn_at IS NULL LIMIT 1",
      [grant.linkId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async loadJob(client: pg.PoolClient, grant: DriverGrant): Promise<DriverJob> {
    const transport = await client.query<Row>(
      "SELECT number, status FROM transport WHERE id = $1",
      [grant.transportId],
    );
    const row = transport.rows[0];
    if (!row) throw this.invalid();
    const status = row["status"] as TransportStatus;
    const stops = await client.query<Row>(
      `SELECT s.sequence, s.type, s.window_start, s.window_end, s.reference, s.notes,
              l.name, l.address_line1, l.address_line2, l.city, l.state, l.postal_code, l.timezone
       FROM stop s JOIN location l ON l.id = s.location_id
       WHERE s.transport_id = $1 ORDER BY s.sequence`,
      [grant.transportId],
    );
    const consent = await client.query<Row>(
      `SELECT accepted_at, withdrawn_at FROM driver_consent
       WHERE driver_link_id = $1 ORDER BY accepted_at DESC, id DESC LIMIT 1`,
      [grant.linkId],
    );
    const latest = consent.rows[0];
    const closed = TRACKING_CLOSED.includes(status);
    const withdrawn = latest?.["withdrawn_at"] as Date | null | undefined;
    return {
      reference: formatReference(row["number"] as number),
      status,
      nextStatuses: closed
        ? []
        : DRIVER_REPORTABLE_STATUSES.filter((next) => canTransition(status, next)),
      sharing: Boolean(latest) && !withdrawn && !closed,
      consent: latest
        ? {
            acceptedAt: (latest["accepted_at"] as Date).toISOString(),
            withdrawnAt: withdrawn ? withdrawn.toISOString() : null,
          }
        : null,
      consentTextVersion: CONSENT_TEXT_VERSION,
      stops: stops.rows.map((stop) => ({
        sequence: stop["sequence"] as number,
        type: stop["type"] as "pickup" | "delivery",
        windowStart: (stop["window_start"] as Date).toISOString(),
        windowEnd: (stop["window_end"] as Date).toISOString(),
        reference: stop["reference"] as string | null,
        notes: stop["notes"] as string | null,
        location: {
          name: stop["name"] as string,
          addressLine1: stop["address_line1"] as string,
          addressLine2: stop["address_line2"] as string | null,
          city: stop["city"] as string,
          state: stop["state"] as string,
          postalCode: stop["postal_code"] as string,
          timezone: stop["timezone"] as string,
        },
      })),
    };
  }

  /** Driver actions are audited as system actions that name the link; the token never appears. */
  private async audit(
    client: pg.PoolClient,
    grant: DriverGrant,
    action: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (organization_id, actor_type, action, entity_type, entity_id, changes)
       VALUES ($1, 'system', $2, 'transport', $3, $4)`,
      [
        grant.organizationId,
        action,
        grant.transportId,
        JSON.stringify({ ...changes, driverLinkId: grant.linkId }),
      ],
    );
  }
}
