import { describe, expect, it } from "vitest";
import { calculate, lineFromRate, type CostLine } from "./calculation.ts";
import { MoneyError } from "./money.ts";

const lines: CostLine[] = [
  { kind: "base_freight", label: "Carrier rate", amount: 85_000 },
  { kind: "accessorial", label: "Liftgate", amount: 5_000 },
];

describe("calculate", () => {
  it("adds the lines and prices by markup", () => {
    const result = calculate({ lines, pricing: { mode: "markup", rate: 1_500 } });
    expect(result.analysis).toEqual({
      cost: 90_000,
      price: 103_500,
      contribution: 13_500,
      markup: 1_500,
      margin: 1_304,
    });
    expect(result.costByKind).toEqual({ base_freight: 85_000, accessorial: 5_000 });
  });

  it("prices by margin, by absolute contribution and by a fixed price", () => {
    expect(calculate({ lines, pricing: { mode: "margin", rate: 1_500 } }).analysis).toMatchObject({
      price: 105_882,
      margin: 1_500,
    });
    expect(
      calculate({ lines, pricing: { mode: "contribution", amount: 13_500 } }).analysis.price,
    ).toBe(103_500);
    expect(calculate({ lines, pricing: { mode: "price", amount: 80_000 } }).analysis).toMatchObject(
      { contribution: -10_000, markup: -1_111, margin: -1_250 },
    );
  });

  it("keeps the chosen pricing method as chosen and does not mutate its input", () => {
    const input = { lines, pricing: { mode: "margin", rate: 1_500 } } as const;
    const result = calculate(input);
    expect(result.pricing).toEqual({ mode: "margin", rate: 1_500 });
    result.lines[0]!.amount = 1;
    expect(lines[0]?.amount).toBe(85_000);
  });

  it("sums lines of the same kind", () => {
    const result = calculate({
      lines: [
        { kind: "toll", label: "Bridge", amount: 1_000 },
        { kind: "toll", label: "Turnpike", amount: 2_500 },
      ],
      pricing: { mode: "markup", rate: 0 },
    });
    expect(result.costByKind).toEqual({ toll: 3_500 });
  });

  it("is deterministic: the same input gives the same result", () => {
    const input = { lines, pricing: { mode: "markup", rate: 1_234 } } as const;
    expect(calculate(input)).toEqual(calculate(input));
  });

  it("refuses an empty calculation and invalid money", () => {
    expect(() => calculate({ lines: [], pricing: { mode: "markup", rate: 0 } })).toThrow(
      MoneyError,
    );
    expect(() => calculate({ lines, pricing: { mode: "margin", rate: 10_000 } })).toThrow(/finite/);
    expect(() =>
      calculate({
        lines: [{ kind: "other", label: "x", amount: 1.5 }],
        pricing: { mode: "markup", rate: 0 },
      }),
    ).toThrow(MoneyError);
  });
});

describe("lineFromRate", () => {
  it("multiplies rate by quantity and records how the amount came about", () => {
    // $2.35 per mile x 412.5 miles = $969.375 -> $969.38
    const line = lineFromRate("mileage", "Line haul", 235, 412_500, "mile");
    expect(line.amount).toBe(96_938);
    expect(line.basis).toEqual({ rate: 235, quantityThousandths: 412_500, unit: "mile" });
  });

  it("is exact for whole quantities and zero", () => {
    expect(lineFromRate("loading", "Pallets", 1_250, 8_000, "pallet").amount).toBe(10_000);
    expect(lineFromRate("loading", "None", 1_250, 0, "pallet").amount).toBe(0);
  });

  it("refuses fractional cents and negative values", () => {
    expect(() => lineFromRate("mileage", "x", 2.5, 1_000, "mile")).toThrow(MoneyError);
    expect(() => lineFromRate("mileage", "x", 250, -1, "mile")).toThrow(MoneyError);
  });
});
