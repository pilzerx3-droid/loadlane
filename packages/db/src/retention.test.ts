// Tests of the position retention rule (ADR 0015): what is deleted, what is kept, and that each
// organization's own period is used. Needs the local PostgreSQL (pnpm infra:up).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purgeExpiredPositions } from "./retention.ts";
import { createTestDatabase, type TestDatabase } from "./testing/test-database.ts";
import { withTenant } from "./tenant.ts";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.drop();
});

const q = (sql: string, params: unknown[] = []) => db.ownerPool.query(sql, params);

interface Seeded {
  organizationId: string;
  userId: string;
  customerId: string;
  carrierId: string;
  number: number;
}

async function organization(retentionDays?: number): Promise<Seeded> {
  const organizationId = randomUUID();
  const userId = randomUUID();
  await q(
    "INSERT INTO organization (id, name, slug, timezone, position_retention_days) VALUES ($1, $2, $3, 'UTC', COALESCE($4, 30))",
    [organizationId, "Org", `org-${organizationId}`, retentionDays ?? null],
  );
  await q("INSERT INTO app_user (id, email, display_name) VALUES ($1, $2, 'U')", [
    userId,
    `${userId}@example.com`,
  ]);
  const customer = await q(
    "INSERT INTO customer (organization_id, name) VALUES ($1, 'C') RETURNING id",
    [organizationId],
  );
  const carrier = await q(
    "INSERT INTO carrier (organization_id, name) VALUES ($1, 'K') RETURNING id",
    [organizationId],
  );
  return {
    organizationId,
    userId,
    customerId: (customer.rows[0] as { id: string }).id,
    carrierId: (carrier.rows[0] as { id: string }).id,
    number: 0,
  };
}

/** A transport with a history entry `daysAgo` old and two stored positions. */
async function transportWithPositions(
  org: Seeded,
  status: string,
  daysAgo: number,
): Promise<string> {
  org.number += 1;
  const transport = await q(
    "INSERT INTO transport (organization_id, number, customer_id, carrier_id, status, created_by_user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [org.organizationId, org.number, org.customerId, org.carrierId, status, org.userId],
  );
  const transportId = (transport.rows[0] as { id: string }).id;
  await q(
    "INSERT INTO transport_event (organization_id, transport_id, source, actor_user_id, to_status, occurred_at) VALUES ($1, $2, 'user', $3, $4, now() - make_interval(days => $5))",
    [org.organizationId, transportId, org.userId, status, daysAgo],
  );
  const link = await q(
    "INSERT INTO driver_link (organization_id, transport_id, token_hash, expires_at, created_by_user_id) VALUES ($1, $2, $3, now() + interval '1 day', $4) RETURNING id",
    [org.organizationId, transportId, randomUUID().replaceAll("-", "").padEnd(64, "0"), org.userId],
  );
  const linkId = (link.rows[0] as { id: string }).id;
  for (const lat of [32.1, 32.2]) {
    await q(
      "INSERT INTO position_event (organization_id, transport_id, driver_link_id, recorded_at, latitude, longitude) VALUES ($1, $2, $3, now(), $4, -96)",
      [org.organizationId, transportId, linkId, lat],
    );
  }
  await q(
    "INSERT INTO last_position (organization_id, transport_id, recorded_at, received_at, latitude, longitude) VALUES ($1, $2, now(), now(), 32.2, -96)",
    [org.organizationId, transportId],
  );
  return transportId;
}

const positionsOf = async (transportId: string) =>
  Number(
    (
      (
        await q("SELECT count(*)::int AS n FROM position_event WHERE transport_id = $1", [
          transportId,
        ])
      ).rows[0] as { n: number }
    ).n,
  );
const lastOf = async (transportId: string) =>
  Number(
    (
      (
        await q("SELECT count(*)::int AS n FROM last_position WHERE transport_id = $1", [
          transportId,
        ])
      ).rows[0] as { n: number }
    ).n,
  );

describe("purgeExpiredPositions", () => {
  it("deletes positions of finished transports after the organization's period, and nothing else", async () => {
    const a = await organization(); // default 30 days
    const b = await organization(7);
    const oldFinished = await transportWithPositions(a, "cancelled", 40);
    const recentFinished = await transportWithPositions(a, "cancelled", 10);
    const stillOpen = await transportWithPositions(a, "created", 100);
    const onTheRoad = await transportWithPositions(a, "in_transit", 100);
    const shortPeriod = await transportWithPositions(b, "cancelled", 10);

    const report = await purgeExpiredPositions(db.appPool);
    expect(report.organizations).toBeGreaterThanOrEqual(2);
    expect(report.positionsDeleted).toBe(4); // two transports with two positions each
    expect(report.lastPositionsDeleted).toBe(2);

    expect([await positionsOf(oldFinished), await lastOf(oldFinished)]).toEqual([0, 0]);
    expect([await positionsOf(shortPeriod), await lastOf(shortPeriod)]).toEqual([0, 0]);
    expect([await positionsOf(recentFinished), await lastOf(recentFinished)]).toEqual([2, 1]);
    expect([await positionsOf(stillOpen), await lastOf(stillOpen)]).toEqual([2, 1]);
    expect([await positionsOf(onTheRoad), await lastOf(onTheRoad)]).toEqual([2, 1]);

    // The transport itself and its history stay.
    const kept = await q("SELECT count(*)::int AS n FROM transport WHERE id = $1", [oldFinished]);
    expect((kept.rows[0] as { n: number }).n).toBe(1);
  });

  it("has nothing left to do when run again", async () => {
    const report = await purgeExpiredPositions(db.appPool);
    expect(report.positionsDeleted).toBe(0);
    expect(report.lastPositionsDeleted).toBe(0);
  });
});

describe("who can list organizations", () => {
  it("only the retention job sees every organization", async () => {
    const seen = async (context: Parameters<typeof withTenant>[1]) =>
      withTenant(db.appPool, context, async ({ client }) =>
        Number(
          (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM organization")).rows[0]
            ?.n,
        ),
      );
    expect(await seen({})).toBe(0);
    expect(await seen({ retentionJob: true })).toBeGreaterThanOrEqual(2);
  });

  it("the job flag alone cannot read or delete business data", async () => {
    await withTenant(db.appPool, { retentionJob: true }, async ({ client }) => {
      for (const table of ["transport", "position_event", "customer", "audit_log"]) {
        const result = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
        expect(result.rows[0]?.n, table).toBe(0);
      }
      const deleted = await client.query("DELETE FROM position_event");
      expect(deleted.rowCount).toBe(0);
    });
  });
});

describe("the retention period setting", () => {
  it("accepts 1 to 3650 days and refuses anything else", async () => {
    const org = await organization();
    for (const days of [0, -1, 3651]) {
      await expect(
        q("UPDATE organization SET position_retention_days = $2 WHERE id = $1", [
          org.organizationId,
          days,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    }
    await q("UPDATE organization SET position_retention_days = 3650 WHERE id = $1", [
      org.organizationId,
    ]);
  });
});
