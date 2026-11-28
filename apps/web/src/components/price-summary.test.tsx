import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PriceSummary } from "./price-summary";

const figures = {
  costCents: 90_000,
  priceCents: 103_500,
  contributionCents: 13_500,
  markupBp: 1_500,
  marginBp: 1_304,
};

describe("PriceSummary", () => {
  it("shows cost, price and the three views with their own labels", () => {
    const html = renderToStaticMarkup(<PriceSummary figures={figures} />);
    expect(html).toContain("$900.00");
    expect(html).toContain("$1,035.00");
    expect(html).toContain("$135.00");
    expect(html).toContain("Markup (on cost)");
    expect(html).toContain("15.00 %");
    expect(html).toContain("Margin (on price)");
    expect(html).toContain("13.04 %");
    expect(html).not.toContain("loses money");
  });

  it("warns when the price is below cost", () => {
    const html = renderToStaticMarkup(
      <PriceSummary
        figures={{
          costCents: 100_000,
          priceCents: 90_000,
          contributionCents: -10_000,
          markupBp: -1_000,
          marginBp: -1_111,
        }}
      />,
    );
    expect(html).toContain("-$100.00");
    expect(html).toContain("loses money");
  });

  it("shows n/a instead of a percentage when there is nothing to divide by", () => {
    const html = renderToStaticMarkup(
      <PriceSummary
        figures={{
          costCents: 0,
          priceCents: 0,
          contributionCents: 0,
          markupBp: null,
          marginBp: null,
        }}
      />,
    );
    expect(html).toContain("n/a");
  });
});
