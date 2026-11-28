import { describe, expect, it } from "vitest";
import { applyTariff, isTariffUnit, versionInForce, type TariffLine } from "./tariff.ts";

const lines: TariffLine[] = [
  { kind: "mileage", label: "Line haul", unit: "mile", rate: 235 },
  { kind: "loading", label: "Pallet handling", unit: "pallet", rate: 1_250, minimum: 5_000 },
  { kind: "base_freight", label: "Booking fee", unit: "flat", rate: 2_500 },
];

describe("applyTariff", () => {
  it("prices every line from rate and quantity, and sums them", () => {
    const result = applyTariff(lines, { mile: 412_500, pallet: 8_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines.map((line) => line.amount)).toEqual([96_938, 10_000, 2_500]);
    expect(result.total).toBe(109_438);
    expect(result.lines[0]?.basis).toEqual({
      rate: 235,
      quantityThousandths: 412_500,
      unit: "mile",
    });
    expect(result.lines.every((line) => !line.minimumApplied)).toBe(true);
  });

  it("applies a minimum charge and says so", () => {
    const result = applyTariff(lines, { mile: 100_000, pallet: 2_000 }); // 2 pallets = $25, minimum $50
    if (!result.ok) throw new Error("expected a result");
    expect(result.lines[1]).toMatchObject({ amount: 5_000, minimumApplied: true });
    expect(result.lines[0]?.minimumApplied).toBe(false);
  });

  it("reports missing quantities instead of guessing them", () => {
    expect(applyTariff(lines, { mile: 100_000 })).toEqual({ ok: false, missingUnits: ["pallet"] });
    expect(applyTariff(lines, {})).toEqual({ ok: false, missingUnits: ["mile", "pallet"] });
  });

  it("needs no quantities for flat lines and accepts zero as a real quantity", () => {
    const flat = applyTariff([lines[2] as TariffLine], {});
    expect(flat.ok && flat.total).toBe(2_500);
    const zero = applyTariff([lines[0] as TariffLine], { mile: 0 });
    expect(zero.ok && zero.total).toBe(0);
  });

  it("is deterministic", () => {
    const quantities = { mile: 333_333, pallet: 7_000 };
    expect(applyTariff(lines, quantities)).toEqual(applyTariff(lines, quantities));
  });
});

describe("versionInForce", () => {
  const versions = [
    { version: 1, validFrom: "2030-01-01" },
    { version: 3, validFrom: "2030-07-01" },
    { version: 2, validFrom: "2030-04-01" },
  ];

  it("picks the latest version that has started", () => {
    expect(versionInForce(versions, "2030-05-15")?.version).toBe(2);
    expect(versionInForce(versions, "2030-07-01")?.version).toBe(3);
    expect(versionInForce(versions, "2031-01-01")?.version).toBe(3);
  });

  it("finds nothing before the first version starts", () => {
    expect(versionInForce(versions, "2029-12-31")).toBeUndefined();
    expect(versionInForce([], "2030-01-01")).toBeUndefined();
  });
});

describe("isTariffUnit", () => {
  it("knows the units", () => {
    expect(isTariffUnit("mile")).toBe(true);
    expect(isTariffUnit("kilometer")).toBe(false);
  });
});
