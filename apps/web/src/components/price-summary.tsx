import { formatPercent, formatUsd } from "@loadlane/shared";
import { Card } from "@loadlane/ui";

export interface PriceFigures {
  costCents: number;
  priceCents: number;
  contributionCents: number;
  markupBp: number | null;
  marginBp: number | null;
}

function Figure({ label, hint, value }: { label: string; hint: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-semibold">{value}</dd>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * Cost, price and the three ways to look at the difference, side by side and always labeled:
 * markup is on cost, margin is on price, contribution is an amount. They are never interchangeable.
 */
export function PriceSummary({ figures }: { figures: PriceFigures }) {
  const loss = figures.contributionCents < 0;
  return (
    <Card className="p-5" aria-label="Price summary">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Figure
          label="Total cost"
          hint="Sum of all cost lines"
          value={formatUsd(figures.costCents)}
        />
        <Figure
          label="Selling price"
          hint="What the customer pays"
          value={formatUsd(figures.priceCents)}
        />
        <Figure
          label="Contribution"
          hint="Price minus cost, an amount"
          value={formatUsd(figures.contributionCents)}
        />
        <Figure
          label="Markup (on cost)"
          hint="Contribution divided by cost"
          value={figures.markupBp === null ? "n/a" : formatPercent(figures.markupBp)}
        />
        <Figure
          label="Margin (on price)"
          hint="Contribution divided by price"
          value={figures.marginBp === null ? "n/a" : formatPercent(figures.marginBp)}
        />
      </dl>
      {loss ? (
        <p role="status" className="mt-4 text-sm text-danger">
          The price is below cost: this calculation loses money.
        </p>
      ) : null}
    </Card>
  );
}
