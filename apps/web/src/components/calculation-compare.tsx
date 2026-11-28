import { COST_KIND_LABELS, formatPercent, formatUsd, type CostKind } from "@loadlane/shared";
import { Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@loadlane/ui";
import type { CalculationDetail } from "../lib/calculations";
import { PRICING_MODE_LABELS } from "../lib/calculation-form";

const pct = (bp: number | null) => (bp === null ? "n/a" : formatPercent(bp));

function kindLabel(kind: string): string {
  return Object.hasOwn(COST_KIND_LABELS, kind) ? COST_KIND_LABELS[kind as CostKind] : kind;
}

/** Index of the calculation with the largest value, or -1 when there is a tie or nothing to compare. */
function bestIndex(values: readonly (number | null)[]): number {
  const numbers = values.map((v) => v ?? Number.NEGATIVE_INFINITY);
  const max = Math.max(...numbers);
  if (!Number.isFinite(max)) return -1;
  return numbers.filter((v) => v === max).length === 1 ? numbers.indexOf(max) : -1;
}

/**
 * Two to four calculations side by side. Cost, price, contribution, markup and margin are shown as
 * separate rows and never converted into each other. The best value of a row is marked.
 */
export function CalculationCompare({ calculations }: { calculations: CalculationDetail[] }) {
  const bestMargin = bestIndex(calculations.map((c) => c.marginBp));
  const bestContribution = bestIndex(calculations.map((c) => c.contributionCents));
  const kinds = [...new Set(calculations.flatMap((c) => c.lines.map((line) => line.kind)))];
  const costOf = (calc: CalculationDetail, kind: string) =>
    calc.lines
      .filter((line) => line.kind === kind)
      .reduce((sum, line) => sum + line.amountCents, 0);

  const mark = (index: number, best: number) => (index === best ? " (best)" : "");
  return (
    <Card className="overflow-x-auto p-2 sm:p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead />
            {calculations.map((calc) => (
              <TableHead key={calc.id} className="text-right">
                <a href={`/calculations/${calc.id}`} className="hover:underline">
                  {calc.name}
                </a>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="text-muted-foreground">Customer</TableCell>
            {calculations.map((calc) => (
              <TableCell key={calc.id} className="text-right">
                {calc.customer?.name ?? "—"}
              </TableCell>
            ))}
          </TableRow>
          <TableRow>
            <TableCell className="text-muted-foreground">Price set by</TableCell>
            {calculations.map((calc) => (
              <TableCell key={calc.id} className="text-right">
                {PRICING_MODE_LABELS[calc.pricingMode]}
              </TableCell>
            ))}
          </TableRow>
          {kinds.map((kind) => (
            <TableRow key={kind}>
              <TableCell className="text-muted-foreground">Cost: {kindLabel(kind)}</TableCell>
              {calculations.map((calc) => (
                <TableCell key={calc.id} className="text-right font-mono">
                  {formatUsd(costOf(calc, kind))}
                </TableCell>
              ))}
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="font-semibold">Total cost</TableCell>
            {calculations.map((calc) => (
              <TableCell key={calc.id} className="text-right font-mono font-semibold">
                {formatUsd(calc.costCents)}
              </TableCell>
            ))}
          </TableRow>
          <TableRow>
            <TableCell className="font-semibold">Selling price</TableCell>
            {calculations.map((calc) => (
              <TableCell key={calc.id} className="text-right font-mono font-semibold">
                {formatUsd(calc.priceCents)}
              </TableCell>
            ))}
          </TableRow>
          <TableRow>
            <TableCell>Contribution (amount)</TableCell>
            {calculations.map((calc, index) => (
              <TableCell key={calc.id} className="text-right font-mono">
                {formatUsd(calc.contributionCents)}
                {mark(index, bestContribution)}
              </TableCell>
            ))}
          </TableRow>
          <TableRow>
            <TableCell>Markup (on cost)</TableCell>
            {calculations.map((calc) => (
              <TableCell key={calc.id} className="text-right font-mono">
                {pct(calc.markupBp)}
              </TableCell>
            ))}
          </TableRow>
          <TableRow>
            <TableCell>Margin (on price)</TableCell>
            {calculations.map((calc, index) => (
              <TableCell key={calc.id} className="text-right font-mono">
                {pct(calc.marginBp)}
                {mark(index, bestMargin)}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  );
}
