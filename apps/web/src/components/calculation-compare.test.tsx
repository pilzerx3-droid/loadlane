import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CalculationDetail } from "../lib/calculations";
import { CalculationCompare } from "./calculation-compare";

const base: CalculationDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Markup 15 %",
  customer: { id: "c", name: "Acme" },
  pricingMode: "markup",
  costCents: 90_000,
  priceCents: 103_500,
  contributionCents: 13_500,
  markupBp: 1_500,
  marginBp: 1_304,
  createdAt: "2030-12-01T10:00:00.000Z",
  createdBy: { id: "u", displayName: "Dana" },
  engineVersion: 1,
  lines: [
    { kind: "base_freight", label: "Rate", amountCents: 85_000, basis: null },
    { kind: "accessorial", label: "Liftgate", amountCents: 5_000, basis: null },
  ],
  pricing: { mode: "markup", rateBp: 1_500 },
};
const margin: CalculationDetail = {
  ...base,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Margin 15 %",
  pricingMode: "margin",
  priceCents: 105_882,
  contributionCents: 15_882,
  markupBp: 1_765,
  marginBp: 1_500,
};

describe("CalculationCompare", () => {
  it("shows each calculation in its own column with every figure on its own row", () => {
    const html = renderToStaticMarkup(<CalculationCompare calculations={[base, margin]} />);
    for (const text of [
      "Markup 15 %",
      "Margin 15 %",
      "$1,035.00",
      "$1,058.82",
      "Markup (on cost)",
      "Margin (on price)",
      "Contribution (amount)",
      "Cost: Base freight",
      "Cost: Accessorial services",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain(`/calculations/${base.id}`);
  });

  it("marks the best margin and contribution once, and nothing on a tie", () => {
    const html = renderToStaticMarkup(<CalculationCompare calculations={[base, margin]} />);
    expect(html.match(/\(best\)/g)).toHaveLength(2);
    expect(html).toContain("15.00 % (best)");
    const tie = renderToStaticMarkup(
      <CalculationCompare calculations={[base, { ...base, id: "3" }]} />,
    );
    expect(tie).not.toContain("(best)");
  });

  it("shows n/a for a missing percentage and never marks it best", () => {
    const html = renderToStaticMarkup(
      <CalculationCompare
        calculations={[
          { ...base, marginBp: null },
          { ...base, id: "3", marginBp: null },
        ]}
      />,
    );
    expect(html).toContain("n/a");
    expect(html).not.toContain("(best)");
  });
});
