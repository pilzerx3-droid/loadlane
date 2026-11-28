import type pg from "pg";
import { withTenant } from "./tenant.ts";

/**
 * The retention rule for driver positions (ADR 0015): positions of a transport are deleted once the
 * transport has been finished (delivered, completed or cancelled) for the organization's
 * `position_retention_days`. The age counts from the transport's last history entry. Everything
 * else about the transport stays. The job visits each organization on its own, so row-level
 * security limits every delete to that organization.
 */
export interface RetentionReport {
  organizations: number;
  positionsDeleted: number;
  lastPositionsDeleted: number;
}

export async function purgeExpiredPositions(pool: pg.Pool): Promise<RetentionReport> {
  const organizations = await withTenant(pool, { retentionJob: true }, async ({ client }) => {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM organization WHERE deleted_at IS NULL ORDER BY id",
    );
    return result.rows.map((row) => row.id);
  });

  const report: RetentionReport = {
    organizations: organizations.length,
    positionsDeleted: 0,
    lastPositionsDeleted: 0,
  };
  for (const organizationId of organizations) {
    await withTenant(pool, { organizationId }, async ({ client }) => {
      const eligible = `
        SELECT t.id FROM transport t
        WHERE t.status IN ('delivered', 'completed', 'cancelled')
          AND (SELECT max(e.occurred_at) FROM transport_event e WHERE e.transport_id = t.id)
              < now() - make_interval(days => (SELECT position_retention_days FROM organization LIMIT 1))`;
      const events = await client.query(
        `DELETE FROM position_event WHERE transport_id IN (${eligible})`,
      );
      const last = await client.query(
        `DELETE FROM last_position WHERE transport_id IN (${eligible})`,
      );
      report.positionsDeleted += events.rowCount ?? 0;
      report.lastPositionsDeleted += last.rowCount ?? 0;
    });
  }
  return report;
}
