import { describe, expect, it } from "vitest";
import {
  buildCalculation,
  emptyCalcForm,
  parseCalcPayload,
  type CalcFormValues,
} from "./calculation-form";

const valid: CalcFormValues = {
  name: "Dallas to Houston",
  customerId: "",
  lines: [
    { kind: "base_freight", label: "Carrier rate", amount: "850" },
    { kind: "accessorial", label: "Liftgate", amount: "50.00" },
  ],
  mode: "markup",
  value: "15",
};

describe("buildCalculation", () => {
  it("builds the API input and a preview with the engine's numbers", () => {
    const built = buildCalculation(valid);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input).toEqual({
      name: "Dallas to Houston",
      lines: [
        { kind: "base_freight", label: "Carrier rate", amountCents: 85_000 },
        { kind: "accessorial", label: "Liftgate", amountCents: 5_000 },
      ],
      pricing: { mode: "markup", rateBp: 1_500 },
    });
    expect(built.preview.analysis).toMatchObject({ cost: 90_000, price: 103_500, margin: 1_304 });
  });

  it("the same 15 % as a margin gives the higher price", () => {
    const built = buildCalculation({ ...valid, mode: "margin" });
    expect(built.ok && built.preview.analysis.price).toBe(105_882);
  });

  it("supports contribution and fixed price with dollars", () => {
    const contribution = buildCalculation({ ...valid, mode: "contribution", value: "135" });
    expect(contribution.ok && contribution.preview.analysis.price).toBe(103_500);
    const fixed = buildCalculation({ ...valid, mode: "price", value: "$1,000.00" });
    expect(fixed.ok && fixed.preview.analysis.contribution).toBe(10_000);
  });

  it("reports what is wrong, field by field, in plain words", () => {
    const built = buildCalculation({
      ...emptyCalcForm(),
      lines: [{ kind: "toll", label: "", amount: "ten" }],
      value: "lots",
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(Object.keys(built.errors).sort()).toEqual([
      "lines.0.amount",
      "lines.0.label",
      "name",
      "value",
    ]);
  });

  it("refuses a margin of 100 % and a customer that is not a list choice", () => {
    const margin = buildCalculation({ ...valid, mode: "margin", value: "100" });
    expect(!margin.ok && margin.errors["value"]).toMatch(/100 %/);
    const customer = buildCalculation({ ...valid, customerId: "not-a-uuid" });
    expect(!customer.ok && customer.errors["customerId"]).toBeTruthy();
  });

  it("needs at least one line", () => {
    const built = buildCalculation({ ...valid, lines: [] });
    expect(!built.ok && built.errors["lines"]).toBeTruthy();
  });
});

describe("parseCalcPayload", () => {
  it("round-trips the form values", () => {
    expect(parseCalcPayload(JSON.stringify(valid))).toEqual(valid);
  });

  it("falls back to an empty form for garbage and ignores unknown values", () => {
    expect(parseCalcPayload("not json")).toEqual(emptyCalcForm());
    expect(parseCalcPayload("42")).toEqual(emptyCalcForm());
    const parsed = parseCalcPayload(JSON.stringify({ ...valid, mode: "magic", extra: 1 }));
    expect(parsed.mode).toBe("margin");
    expect(parsed).not.toHaveProperty("extra");
  });
});
