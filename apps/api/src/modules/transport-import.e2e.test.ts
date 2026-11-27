// End-to-end tests of the CSV import of transports: preview, all-or-nothing, name matching,
// duplicates, time zones and permissions.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "../testing/harness.ts";

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
});

type Json = Record<string, unknown>;

async function body(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

const HEADER =
  "customer,customer_reference,purchase_order,weight_lb,pieces,carrier,pickup_location,pickup_start,pickup_end,delivery_location,delivery_start,delivery_end,notes";

async function workspace(roles: string[] = ["admin"]) {
  const person = await api.person("importer");
  const organizationId = await api.seedOrganization({
    creatorUserId: person.id,
    members: [{ userId: person.id, roles }],
  });
  const as = { token: person.token, organizationId };
  const make = async (path: string, json: Json) => api.call(path, { ...as, json });
  await make("/v1/customers", { name: "Acme Foods" });
  await make("/v1/customers", { name: "Beta Co" });
  await make("/v1/carriers", { name: "Blue Line Trucking" });
  for (const [name, city, state, timezone] of [
    ["Dallas DC", "Dallas", "TX", "America/Chicago"],
    ["Denver Yard", "Denver", "CO", "America/Denver"],
  ]) {
    await make("/v1/locations", {
      name,
      addressLine1: "1 Main St",
      city,
      state,
      postalCode: "75001",
      timezone,
    });
  }
  return as;
}

const GOOD_ROW =
  "Acme Foods,SO-1,PO-1,42000,22,Blue Line Trucking,Dallas DC,2026-12-01 14:00,2026-12-01 16:00,Denver Yard,12/02/2026 8:00 AM,12/02/2026 12:00 PM,Call ahead";

async function runImport(
  as: { token: string; organizationId: string },
  csv: string,
  dryRun: boolean,
) {
  const response = await api.call("/v1/transports/import", { ...as, json: { csv, dryRun } });
  return { response, report: await body(response) };
}

const rowProblems = (report: Json) =>
  (report["rows"] as { line: number; problems: string[] }[]).map((row) => row.problems);

describe("preview", () => {
  it("checks a good file and writes nothing", async () => {
    const as = await workspace();
    const { response, report } = await runImport(as, `${HEADER}\n${GOOD_ROW}\n`, true);
    expect(response.status).toBe(200);
    expect(report).toMatchObject({
      status: "preview",
      summary: { total: 1, valid: 1, failed: 0 },
      created: [],
    });
    const list = await body(await api.call("/v1/transports", as));
    expect((list["page"] as Json)["total"]).toBe(0);
  });

  it("defaults to a preview when dryRun is left out", async () => {
    const as = await workspace();
    const response = await api.call("/v1/transports/import", {
      ...as,
      json: { csv: `${HEADER}\n${GOOD_ROW}\n` },
    });
    expect((await body(response))["status"]).toBe("preview");
    expect(((await body(await api.call("/v1/transports", as)))["page"] as Json)["total"]).toBe(0);
  });
});

describe("import", () => {
  it("creates every row with its stops in the zone of each location, and records history and an audit entry", async () => {
    const as = await workspace();
    const second = GOOD_ROW.replace("SO-1", "SO-2").replace("Call ahead", "");
    const { report } = await runImport(as, `${HEADER}\r\n${GOOD_ROW}\r\n${second}\r\n`, false);
    expect(report).toMatchObject({ status: "imported", created: ["LL-000001", "LL-000002"] });

    const list = await body(await api.call("/v1/transports", as));
    expect((list["page"] as Json)["total"]).toBe(2);
    const first = (list["items"] as Json[]).find(
      (item) => item["customerReference"] === "SO-1",
    ) as Json;
    expect(first).toMatchObject({
      status: "created",
      customer: { name: "Acme Foods" },
      carrier: { name: "Blue Line Trucking" },
      origin: { city: "Dallas", windowStart: "2026-12-01T20:00:00.000Z" },
      destination: { city: "Denver", windowStart: "2026-12-02T15:00:00.000Z" },
    });
    const detail = await body(await api.call(`/v1/transports/${String(first["id"])}`, as));
    expect(detail).toMatchObject({
      weightLb: 42000,
      pieces: 22,
      purchaseOrder: "PO-1",
      notes: "Call ahead",
    });
    expect(detail["events"]).toHaveLength(1);

    const audit = await api.db.ownerPool.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE action LIKE 'transport.%' ORDER BY occurred_at, id",
    );
    expect(audit.rows.filter((row) => row.action === "transport.imported")).toHaveLength(1);
  });

  it("accepts quoted fields, a byte order mark, different column order and optional columns left out", async () => {
    const as = await workspace();
    const csv =
      "﻿Pickup Location,Customer,Pickup Start,Pickup End,Delivery Location,Delivery Start,Delivery End\n" +
      '"Dallas DC","Acme Foods",2026-12-01 14:00,2026-12-01 16:00,"Denver Yard",2026-12-02 08:00,2026-12-02 12:00\n';
    const { report } = await runImport(as, csv, false);
    expect(report["status"]).toBe("imported");
  });

  it("imports nothing when one row has a problem", async () => {
    const as = await workspace();
    const bad = GOOD_ROW.replace("SO-1", "SO-2").replace("Acme Foods", "Unknown Co");
    const { report } = await runImport(as, `${HEADER}\n${GOOD_ROW}\n${bad}\n`, false);
    expect(report).toMatchObject({
      status: "rejected",
      summary: { total: 2, valid: 1, failed: 1 },
    });
    expect(rowProblems(report)[0]).toEqual([]);
    expect(rowProblems(report)[1]?.[0]).toMatch(/Customer "Unknown Co" was not found/);
    expect(((await body(await api.call("/v1/transports", as)))["page"] as Json)["total"]).toBe(0);
  });

  it("reports the line of each problem", async () => {
    const as = await workspace();
    const bad = GOOD_ROW.replace("SO-1", "SO-2").replace("Dallas DC", "Nowhere");
    const { report } = await runImport(as, `${HEADER}\n${GOOD_ROW}\n\n${bad}\n`, true);
    expect((report["rows"] as { line: number }[]).map((row) => row.line)).toEqual([2, 4]);
  });
});

describe("row problems", () => {
  const cases: [string, (row: string) => string, RegExp][] = [
    [
      "an unknown carrier",
      (row) => row.replace("Blue Line Trucking", "Ghost Freight"),
      /Carrier "Ghost Freight" was not found/,
    ],
    [
      "an unknown pickup location",
      (row) => row.replace("Dallas DC", "Nowhere"),
      /Pickup location "Nowhere" was not found/,
    ],
    [
      "a bad pickup time",
      (row) => row.replace("2026-12-01 14:00", "soon"),
      /Pickup start "soon" is not a date and time/,
    ],
    [
      "a window that ends early",
      (row) => row.replace("2026-12-01 16:00", "2026-12-01 10:00"),
      /Pickup window ends before it starts/,
    ],
    [
      "an impossible date",
      (row) => row.replace("2026-12-01 14:00", "2026-02-30 14:00"),
      /not a date and time/,
    ],
    ["a negative weight", (row) => row.replace("42000", "-5"), /Weight "-5"/],
    ["fractional pieces", (row) => row.replace(",22,", ",2.5,"), /Pieces "2.5"/],
    ["a missing customer", (row) => row.replace("Acme Foods", ""), /customer is missing/],
  ];
  it.each(cases)("reports %s", async (_name, change, pattern) => {
    const as = await workspace();
    const { report } = await runImport(as, `${HEADER}\n${change(GOOD_ROW)}\n`, true);
    expect(report["status"]).toBe("preview");
    expect((report["summary"] as Json)["failed"]).toBe(1);
    expect(rowProblems(report)[0]?.join(" ")).toMatch(pattern);
  });

  it("matches names ignoring case and surrounding blanks", async () => {
    const as = await workspace();
    const { report } = await runImport(
      as,
      `${HEADER}\n${GOOD_ROW.replace("Acme Foods", "  ACME foods ")}\n`,
      true,
    );
    expect((report["summary"] as Json)["failed"]).toBe(0);
  });

  it("does not match archived records", async () => {
    const as = await workspace();
    const customers = await body(await api.call("/v1/customers?q=acme", as));
    const id = String(((customers["items"] as Json[])[0] as Json)["id"]);
    await api.call(`/v1/customers/${id}`, { ...as, method: "PATCH", json: { archived: true } });
    const { report } = await runImport(as, `${HEADER}\n${GOOD_ROW}\n`, true);
    expect(rowProblems(report)[0]?.join(" ")).toMatch(/Customer "Acme Foods" was not found/);
  });

  it("refuses names that match several locations instead of guessing", async () => {
    const as = await workspace();
    await api.call("/v1/locations", {
      ...as,
      json: {
        name: "Dallas DC",
        addressLine1: "9 Other St",
        city: "Dallas",
        state: "TX",
        postalCode: "75002",
        timezone: "America/Chicago",
      },
    });
    const { report } = await runImport(as, `${HEADER}\n${GOOD_ROW}\n`, true);
    expect(rowProblems(report)[0]?.join(" ")).toMatch(/matches 2 records/);
  });
});

describe("duplicates", () => {
  it("flags a customer reference that repeats within the file", async () => {
    const as = await workspace();
    const { report } = await runImport(as, `${HEADER}\n${GOOD_ROW}\n${GOOD_ROW}\n`, true);
    expect(rowProblems(report)[1]?.join(" ")).toMatch(/already appears on line 2/);
  });

  it("flags a customer reference that already belongs to a transport of the same customer, ignoring case", async () => {
    const as = await workspace();
    expect((await runImport(as, `${HEADER}\n${GOOD_ROW}\n`, false)).report["status"]).toBe(
      "imported",
    );
    const again = GOOD_ROW.replace("SO-1", "so-1");
    const { report } = await runImport(as, `${HEADER}\n${again}\n`, false);
    expect(report["status"]).toBe("rejected");
    expect(rowProblems(report)[0]?.join(" ")).toMatch(/already exists on LL-000001/);
  });

  it("allows the same reference for another customer and after the first transport was cancelled", async () => {
    const as = await workspace();
    await runImport(as, `${HEADER}\n${GOOD_ROW}\n`, false);
    const otherCustomer = GOOD_ROW.replace("Acme Foods", "Beta Co");
    expect(
      (await runImport(as, `${HEADER}\n${otherCustomer}\n`, true)).report["summary"],
    ).toMatchObject({ failed: 0 });

    const list = await body(await api.call("/v1/transports", as));
    const id = String(((list["items"] as Json[])[0] as Json)["id"]);
    await api.call(`/v1/transports/${id}/status`, { ...as, json: { status: "cancelled" } });
    expect((await runImport(as, `${HEADER}\n${GOOD_ROW}\n`, true)).report["summary"]).toMatchObject(
      { failed: 0 },
    );
  });
});

describe("the file as a whole", () => {
  it.each([
    ["an empty file", "", /empty/],
    ["only a header", `${HEADER}\n`, /no rows/],
    [
      "a missing required column",
      "customer,pickup_location\nAcme Foods,Dallas DC\n",
      /"pickup_start" is missing/,
    ],
    ["an unknown column", `${HEADER},color\n${GOOD_ROW},red\n`, /Unknown column "color"/],
    ["a repeated column", `${HEADER},customer\n${GOOD_ROW},x\n`, /appears twice/],
    ["a quote that never closes", `${HEADER}\n"Acme Foods,SO-1\n`, /cannot be read as CSV/],
  ])("rejects %s", async (_name, csv, pattern) => {
    const as = await workspace();
    const { response, report } = await runImport(as, csv, csv === "" ? true : false);
    if (csv === "") {
      expect(response.status).toBe(400);
      return;
    }
    expect(report["status"]).toBe("rejected");
    expect((report["fileProblems"] as string[]).join(" ")).toMatch(pattern);
  });

  it("limits the number of rows", async () => {
    const as = await workspace();
    const rows = Array.from({ length: 201 }, (_, index) => GOOD_ROW.replace("SO-1", `SO-${index}`));
    const { report } = await runImport(as, `${HEADER}\n${rows.join("\n")}\n`, true);
    expect((report["fileProblems"] as string[]).join(" ")).toMatch(/at most 200/i);
  });

  it("rejects a body that is too large and unknown fields", async () => {
    const as = await workspace();
    const big = await api.call("/v1/transports/import", {
      ...as,
      json: { csv: "x".repeat(90_001) },
    });
    expect(big.status).toBe(400);
    const extra = await api.call("/v1/transports/import", {
      ...as,
      json: { csv: HEADER, organizationId: "x" },
    });
    expect(extra.status).toBe(400);
  });
});

describe("permissions and isolation", () => {
  it.each([
    ["admin", 200],
    ["dispatcher", 200],
    ["sales", 403],
    ["carrier_user", 403],
  ])("%s -> %i", async (role, expected) => {
    const as = await workspace([role]);
    const response = await api.call("/v1/transports/import", {
      ...as,
      json: { csv: HEADER, dryRun: true },
    });
    expect(response.status).toBe(expected);
  });

  it("matches only names of the caller's own organization", async () => {
    const a = await workspace();
    const b = await workspace();
    await runImport(a, `${HEADER}\n${GOOD_ROW}\n`, false);
    // Organization B has the same names, so it imports; its own counter starts at 1 and A's data stays separate.
    const { report } = await runImport(b, `${HEADER}\n${GOOD_ROW}\n`, false);
    expect(report).toMatchObject({ status: "imported", created: ["LL-000001"] });
    expect(((await body(await api.call("/v1/transports", a)))["page"] as Json)["total"]).toBe(1);
  });
});
