// Price lists (tariffs) turned into cost lines (ADR 0007). Pure functions: the same list and the
// same quantities always give the same lines, which is what lets a calculation record the exact
// tariff version it used. Amounts are whole cents; quantities are thousandths of the unit.

import { COST_KINDS, lineFromRate, type CostKind, type CostLine } from "./calculation.ts";
import type { Cents } from "./money.ts";

export const TARIFF_UNITS = ["flat", "mile", "pallet", "lb", "hour"] as const;
export type TariffUnit = (typeof TARIFF_UNITS)[number];

export const TARIFF_UNIT_LABELS: Record<TariffUnit, string> = {
  flat: "per shipment",
  mile: "per mile",
  pallet: "per pallet",
  lb: "per pound",
  hour: "per hour",
};

export interface TariffLine {
  kind: CostKind;
  label: string;
  unit: TariffUnit;
  /** Price per unit in cents. */
  rate: Cents;
  /** A minimum charge in cents: the line is never less than this. */
  minimum?: Cents | undefined;
}

export interface AppliedLine extends CostLine {
  /** True when the minimum charge, not rate x quantity, set the amount. */
  minimumApplied: boolean;
}

export type ApplyResult =
  { ok: true; lines: AppliedLine[]; total: Cents } | { ok: false; missingUnits: TariffUnit[] };

/** Quantities by unit in thousandths (412.5 miles = 412500). `flat` needs none: it is always one. */
export type Quantities = Partial<Record<Exclude<TariffUnit, "flat">, number>>;

export function isTariffUnit(value: string): value is TariffUnit {
  return (TARIFF_UNITS as readonly string[]).includes(value);
}

export function isCostKind(value: string): value is CostKind {
  return (COST_KINDS as readonly string[]).includes(value);
}

/**
 * Prices a shipment from the lines of one tariff version. Units without a quantity are reported
 * instead of guessed: a price list is never applied with invented quantities.
 */
export function applyTariff(lines: readonly TariffLine[], quantities: Quantities): ApplyResult {
  const missing = new Set<TariffUnit>();
  for (const line of lines) {
    if (line.unit !== "flat" && quantities[line.unit] === undefined) missing.add(line.unit);
  }
  if (missing.size > 0) return { ok: false, missingUnits: [...missing] };

  const applied: AppliedLine[] = lines.map((line) => {
    const quantity = line.unit === "flat" ? 1_000 : (quantities[line.unit] ?? 0);
    const computed = lineFromRate(line.kind, line.label, line.rate, quantity, line.unit);
    const minimumApplied = line.minimum !== undefined && computed.amount < line.minimum;
    return {
      ...computed,
      amount: minimumApplied ? (line.minimum ?? computed.amount) : computed.amount,
      minimumApplied,
    };
  });
  return { ok: true, lines: applied, total: applied.reduce((sum, line) => sum + line.amount, 0) };
}

/** The version in force on `date` (YYYY-MM-DD): the one with the latest start on or before it. */
export function versionInForce<T extends { validFrom: string }>(
  versions: readonly T[],
  date: string,
): T | undefined {
  let best: T | undefined;
  for (const version of versions) {
    if (version.validFrom <= date && (best === undefined || version.validFrom > best.validFrom)) {
      best = version;
    }
  }
  return best;
}
