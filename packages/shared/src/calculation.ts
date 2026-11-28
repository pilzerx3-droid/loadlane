// The calculation engine (CALCULATE pillar, ADR 0007). Pure functions: the same input always gives
// the same result, which is what lets a stored calculation be an immutable snapshot. Amounts are
// whole cents and rates are basis points (see money.ts).

import {
  MoneyError,
  analyzePrice,
  priceFromContribution,
  priceFromMargin,
  priceFromMarkup,
  sumCents,
  type BasisPoints,
  type Cents,
  type PriceAnalysis,
} from "./money.ts";

export const COST_KINDS = [
  "base_freight",
  "mileage",
  "fuel_surcharge",
  "toll",
  "loading",
  "unloading",
  "detention",
  "cleaning",
  "hazmat",
  "reefer",
  "accessorial",
  "other",
] as const;
export type CostKind = (typeof COST_KINDS)[number];

export const COST_KIND_LABELS: Record<CostKind, string> = {
  base_freight: "Base freight",
  mileage: "Mileage",
  fuel_surcharge: "Fuel surcharge",
  toll: "Tolls",
  loading: "Loading",
  unloading: "Unloading",
  detention: "Detention / waiting",
  cleaning: "Cleaning",
  hazmat: "Hazmat surcharge",
  reefer: "Reefer surcharge",
  accessorial: "Accessorial services",
  other: "Other",
};

export interface CostLine {
  kind: CostKind;
  label: string;
  amount: Cents;
  /** How the amount came about, so every figure can be traced to its inputs. */
  basis?: { rate: Cents; quantityThousandths: number; unit: string } | undefined;
}

/**
 * How the selling price is set from the total cost. The four ways are never converted into each
 * other: the one the user chose is stored as chosen.
 */
export type PricingMethod =
  | { mode: "markup"; rate: BasisPoints }
  | { mode: "margin"; rate: BasisPoints }
  | { mode: "contribution"; amount: Cents }
  | { mode: "price"; amount: Cents };

export interface CalculationInput {
  lines: readonly CostLine[];
  pricing: PricingMethod;
}

export interface CalculationResult {
  lines: CostLine[];
  /** Total cost per kind, only kinds that occur. */
  costByKind: Partial<Record<CostKind, Cents>>;
  analysis: PriceAnalysis;
  pricing: PricingMethod;
}

/** A line from a rate and a quantity: amount = rate x quantity, rounded half up to the cent. */
export function lineFromRate(
  kind: CostKind,
  label: string,
  rate: Cents,
  quantityThousandths: number,
  unit: string,
): CostLine {
  if (!Number.isSafeInteger(rate) || rate < 0) {
    throw new MoneyError("invalid_amount", "rate must be a whole number of cents, zero or more");
  }
  if (!Number.isSafeInteger(quantityThousandths) || quantityThousandths < 0) {
    throw new MoneyError("invalid_amount", "quantity must be whole thousandths, zero or more");
  }
  const exact = BigInt(rate) * BigInt(quantityThousandths);
  const amount = Number((exact * 2n + 1000n) / 2000n);
  return { kind, label, amount, basis: { rate, quantityThousandths, unit } };
}

/** Computes cost, price and the three views of the margin. Throws MoneyError on invalid input. */
export function calculate(input: CalculationInput): CalculationResult {
  if (input.lines.length === 0) {
    throw new MoneyError("invalid_amount", "a calculation needs at least one cost line");
  }
  const costByKind: Partial<Record<CostKind, Cents>> = {};
  for (const line of input.lines) {
    costByKind[line.kind] = sumCents([costByKind[line.kind] ?? 0, line.amount]);
  }
  const cost = sumCents(input.lines.map((line) => line.amount));
  const { pricing } = input;
  let price: Cents;
  switch (pricing.mode) {
    case "markup":
      price = priceFromMarkup(cost, pricing.rate);
      break;
    case "margin":
      price = priceFromMargin(cost, pricing.rate);
      break;
    case "contribution":
      price = priceFromContribution(cost, pricing.amount);
      break;
    case "price":
      price = pricing.amount;
      break;
  }
  return {
    lines: input.lines.map((line) => ({ ...line })),
    costByKind,
    analysis: analyzePrice(cost, price),
    pricing,
  };
}
