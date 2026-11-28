import {
  COST_KIND_LABELS,
  formatPercent,
  formatUsd,
  formatInZone,
  type CostKind,
} from "@loadlane/shared";
import {
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@loadlane/ui";
import type { CalculationDetail, CalculationSummary } from "../lib/calculations";
import { PRICING_MODE_LABELS } from "../lib/calculation-form";
import { PriceSummary } from "./price-summary";

function kindLabel(kind: string): string {
  return Object.hasOwn(COST_KIND_LABELS, kind) ? COST_KIND_LABELS[kind as CostKind] : kind;
}

export function CalculationsList({
  items,
  timeZone,
  canManage,
}: {
  items: CalculationSummary[];
  timeZone: string;
  canManage: boolean;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No calculations yet"
        description="Calculate a freight price from your costs. Saved calculations are frozen: later changes never alter them."
        action={
          canManage ? (
            <a href="/calculations/new" className="text-sm underline">
              New calculation
            </a>
          ) : undefined
        }
      />
    );
  }
  return (
    <Card className="p-2 sm:p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Margin</TableHead>
            <TableHead>Saved</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <a href={`/calculations/${item.id}`} className="font-medium hover:underline">
                  {item.name}
                </a>
              </TableCell>
              <TableCell>{item.customer?.name ?? "—"}</TableCell>
              <TableCell className="text-right font-mono">{formatUsd(item.costCents)}</TableCell>
              <TableCell className="text-right font-mono">{formatUsd(item.priceCents)}</TableCell>
              <TableCell className="text-right font-mono">
                {item.marginBp === null ? "n/a" : formatPercent(item.marginBp)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatInZone(item.createdAt, timeZone)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/** A saved calculation: the frozen result, how the price was set and every cost line with its basis. */
export function CalculationDetailView({
  calculation,
  timeZone,
}: {
  calculation: CalculationDetail;
  timeZone: string;
}) {
  const mode = calculation.pricingMode;
  return (
    <div className="space-y-5">
      <PriceSummary figures={calculation} />
      <Card className="p-5">
        <CardHeader>
          <CardTitle>Cost lines</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>How it was calculated</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calculation.lines.map((line, index) => (
              <TableRow key={index}>
                <TableCell>{kindLabel(line.kind)}</TableCell>
                <TableCell>{line.label}</TableCell>
                <TableCell className="text-muted-foreground">
                  {line.basis
                    ? `${formatUsd(line.basis.rateCents)} per ${line.basis.unit} × ${line.basis.quantityThousandths / 1000}`
                    : "Entered as an amount"}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatUsd(line.amountCents)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Card className="p-5 text-sm">
        <p>
          <span className="font-semibold">Price set by:</span> {PRICING_MODE_LABELS[mode]}
          {typeof calculation.pricing["rateBp"] === "number"
            ? `: ${formatPercent(calculation.pricing["rateBp"])}`
            : typeof calculation.pricing["amountCents"] === "number"
              ? `: ${formatUsd(calculation.pricing["amountCents"])}`
              : ""}
        </p>
        <p className="mt-1 text-muted-foreground">
          Saved {formatInZone(calculation.createdAt, timeZone)} by{" "}
          {calculation.createdBy.displayName}
          {calculation.customer ? ` for ${calculation.customer.name}` : ""}. This calculation is
          frozen (rules version {calculation.engineVersion}).
        </p>
      </Card>
    </div>
  );
}
