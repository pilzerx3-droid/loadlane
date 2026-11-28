// Money math for quotes and calculations (CLAUDE.md rule 6, ADR 0007).
//
// Amounts are whole cents (USD). Rates are basis points: 1 % = 100 bp.
// Three different ideas are never mixed:
//   markup        = contribution / cost   (an add-on to cost)
//   margin        = contribution / price  (a share of the price)
//   contribution  = price - cost          (an absolute amount)
// Example: cost $900.00 with a 15 % markup is $1,035.00; with a 15 % margin it is $1,058.82.
// Rounding is half up to the cent, done once at the end of each conversion with exact integers.

export type Cents = number;
export type BasisPoints = number;

export class MoneyError extends Error {
  readonly code: "invalid_amount" | "invalid_rate" | "margin_too_high";
  constructor(code: MoneyError["code"], message: string) {
    super(message);
    this.name = "MoneyError";
    this.code = code;
  }
}

function assertCents(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MoneyError("invalid_amount", `${name} must be a whole number of cents, zero or more`);
  }
}

function assertRate(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MoneyError("invalid_rate", `${name} must be whole basis points, zero or more`);
  }
}

/** Divides and rounds half up. Both operands are non-negative, the divisor is positive. */
function divideRoundHalfUp(numerator: bigint, divisor: bigint): bigint {
  return (numerator * 2n + divisor) / (divisor * 2n);
}

/** Price when the cost is increased by a percentage of the cost: price = cost x (1 + markup). */
export function priceFromMarkup(cost: Cents, markup: BasisPoints): Cents {
  assertCents("cost", cost);
  assertRate("markup", markup);
  return Number(divideRoundHalfUp(BigInt(cost) * (10_000n + BigInt(markup)), 10_000n));
}

/** Price when the contribution is a percentage of the price: price = cost / (1 - margin). */
export function priceFromMargin(cost: Cents, margin: BasisPoints): Cents {
  assertCents("cost", cost);
  assertRate("margin", margin);
  if (margin >= 10_000) {
    throw new MoneyError("margin_too_high", "a margin of 100 % or more has no finite price");
  }
  return Number(divideRoundHalfUp(BigInt(cost) * 10_000n, 10_000n - BigInt(margin)));
}

/** Price when a fixed amount is added to the cost. */
export function priceFromContribution(cost: Cents, contribution: Cents): Cents {
  assertCents("cost", cost);
  assertCents("contribution", contribution);
  return cost + contribution;
}

export interface PriceAnalysis {
  cost: Cents;
  price: Cents;
  /** price - cost. Negative when the price is below cost. */
  contribution: Cents;
  /** contribution / cost in basis points, or null when the cost is zero. */
  markup: BasisPoints | null;
  /** contribution / price in basis points, or null when the price is zero. */
  margin: BasisPoints | null;
}

function ratio(numerator: number, denominator: number): BasisPoints | null {
  if (denominator === 0) return null;
  const sign = numerator < 0 ? -1n : 1n;
  const magnitude = BigInt(Math.abs(numerator)) * 10_000n;
  return Number(sign * divideRoundHalfUp(magnitude, BigInt(denominator)));
}

/** Shows all three views of the same cost and price, side by side and never converted into each other. */
export function analyzePrice(cost: Cents, price: Cents): PriceAnalysis {
  assertCents("cost", cost);
  assertCents("price", price);
  const contribution = price - cost;
  return {
    cost,
    price,
    contribution,
    markup: ratio(contribution, cost),
    margin: ratio(contribution, price),
  };
}

/** The sum of line amounts in cents. */
export function sumCents(amounts: readonly Cents[]): Cents {
  let total = 0;
  for (const amount of amounts) {
    assertCents("amount", amount);
    total += amount;
  }
  if (!Number.isSafeInteger(total))
    throw new MoneyError("invalid_amount", "the total is too large");
  return total;
}

/** "$1,058.82" for display. Whole cents in, text out; no floating point arithmetic on money. */
export function formatUsd(cents: Cents): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = String(absolute % 100).padStart(2, "0");
  return `${negative ? "-" : ""}$${dollars}.${rest}`;
}

/** "15.00 %" for display. */
export function formatPercent(bp: BasisPoints): string {
  const negative = bp < 0;
  const absolute = Math.abs(bp);
  return `${negative ? "-" : ""}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")} %`;
}
