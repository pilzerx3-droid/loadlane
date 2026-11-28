import { describe, expect, it } from "vitest";
import {
  MoneyError,
  analyzePrice,
  formatPercent,
  formatUsd,
  parsePercent,
  parseUsd,
  priceFromContribution,
  priceFromMargin,
  priceFromMarkup,
  sumCents,
} from "./money.ts";

describe("markup, margin and contribution are different things", () => {
  const cost = 90_000; // $900.00

  it("a 15 % markup on cost gives $1,035.00", () => {
    expect(priceFromMarkup(cost, 1_500)).toBe(103_500);
  });

  it("a 15 % margin on price gives $1,058.82, not $1,035.00", () => {
    expect(priceFromMargin(cost, 1_500)).toBe(105_882);
    expect(priceFromMargin(cost, 1_500)).not.toBe(priceFromMarkup(cost, 1_500));
  });

  it("an absolute contribution of $135.00 gives $1,035.00", () => {
    expect(priceFromContribution(cost, 13_500)).toBe(103_500);
  });

  it("analysis reports all three views of the same price without converting them", () => {
    expect(analyzePrice(cost, 103_500)).toEqual({
      cost,
      price: 103_500,
      contribution: 13_500,
      markup: 1_500,
      margin: 1_304, // 135 / 1035 = 13.04 %
    });
    expect(analyzePrice(cost, 105_882)).toMatchObject({ contribution: 15_882, margin: 1_500 });
  });
});

describe("rounding and limits", () => {
  it("rounds half up to the cent", () => {
    expect(priceFromMarkup(1, 5_000)).toBe(2); // 1.5 -> 2
    expect(priceFromMarkup(3, 1_667)).toBe(4); // 3.5001 -> 4
    expect(priceFromMarkup(10, 1_500)).toBe(12); // 11.5 -> 12
  });

  it("handles a zero cost and zero rates", () => {
    expect(priceFromMarkup(0, 1_500)).toBe(0);
    expect(priceFromMargin(0, 1_500)).toBe(0);
    expect(priceFromMargin(90_000, 0)).toBe(90_000);
    expect(analyzePrice(0, 0)).toEqual({
      cost: 0,
      price: 0,
      contribution: 0,
      markup: null,
      margin: null,
    });
  });

  it("reports a loss as a negative contribution, markup and margin", () => {
    expect(analyzePrice(100_000, 90_000)).toMatchObject({
      contribution: -10_000,
      markup: -1_000,
      margin: -1_111,
    });
  });

  it("refuses a margin of 100 % or more", () => {
    expect(() => priceFromMargin(100, 10_000)).toThrow(MoneyError);
    expect(() => priceFromMargin(100, 12_000)).toThrow(/finite/);
  });

  it("refuses fractional cents, negative amounts and fractional rates", () => {
    expect(() => priceFromMarkup(10.5, 100)).toThrow(MoneyError);
    expect(() => priceFromMarkup(-1, 100)).toThrow(MoneyError);
    expect(() => priceFromMarkup(100, 12.5)).toThrow(MoneyError);
    expect(() => priceFromContribution(100, Number.NaN)).toThrow(MoneyError);
  });

  it("stays exact for very large amounts", () => {
    const cost = 900_719_925_474; // $9 billion, well beyond what floating point multiplies exactly at 10^4
    expect(priceFromMarkup(cost, 1_500)).toBe(1_035_827_914_295); // exact: cost x 1.15, rounded half up
  });
});

describe("reading what people type", () => {
  it.each([
    ["1058.82", 105_882],
    ["1,058.82", 105_882],
    ["$1,058.82", 105_882],
    [" 900 ", 90_000],
    ["0.5", 50],
    ["0", 0],
  ])("amount %j is %d cents", (text, cents) => {
    expect(parseUsd(text)).toBe(cents);
  });

  it.each(["", "abc", "-5", "1.234", "1.2.3", "12 dollars", "$", "1e3"])(
    "amount %j is not an amount",
    (text) => {
      expect(parseUsd(text)).toBeUndefined();
    },
  );

  it.each([
    ["15", 1_500],
    ["15.5", 1_550],
    ["15 %", 1_500],
    ["15.25%", 1_525],
    ["0", 0],
  ])("percent %j is %d basis points", (text, bp) => {
    expect(parsePercent(text)).toBe(bp);
  });

  it.each(["", "-1", "15.123", "fifteen"])("percent %j is not a percentage", (text) => {
    expect(parsePercent(text)).toBeUndefined();
  });
});

describe("sums and display", () => {
  it("sums whole cents", () => {
    expect(sumCents([85_000, 5_000, 1])).toBe(90_001);
    expect(sumCents([])).toBe(0);
    expect(() => sumCents([1.5])).toThrow(MoneyError);
  });

  it("formats dollars and percentages", () => {
    expect(formatUsd(105_882)).toBe("$1,058.82");
    expect(formatUsd(5)).toBe("$0.05");
    expect(formatUsd(-250_000)).toBe("-$2,500.00");
    expect(formatPercent(1_500)).toBe("15.00 %");
    expect(formatPercent(1_304)).toBe("13.04 %");
    expect(formatPercent(-1_111)).toBe("-11.11 %");
  });
});
