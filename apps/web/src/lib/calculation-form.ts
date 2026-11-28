import {
  COST_KINDS,
  MoneyError,
  calculate,
  parsePercent,
  parseUsd,
  type CalculationResult,
  type CostKind,
} from "@loadlane/shared";

// The calculator form: what a person types, how it becomes the API input, and the live preview.
// The preview uses the same engine as the API, so the numbers on screen are the numbers that get saved.

export const PRICING_MODES = ["markup", "margin", "contribution", "price"] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

export const PRICING_MODE_LABELS: Record<PricingMode, string> = {
  markup: "Markup on cost (%)",
  margin: "Margin on price (%)",
  contribution: "Contribution ($ added to cost)",
  price: "Fixed selling price ($)",
};

export interface CalcLineValues {
  kind: CostKind;
  label: string;
  /** Dollars as typed, for example "850" or "1,250.50". */
  amount: string;
}

export interface CalcFormValues {
  name: string;
  customerId: string;
  lines: CalcLineValues[];
  mode: PricingMode;
  /** A percentage for markup and margin, dollars for contribution and price. */
  value: string;
  /** Tariff versions the cost lines were filled from; recorded in the saved calculation. */
  tariffVersionIds: string[];
}

export function emptyCalcForm(): CalcFormValues {
  return {
    name: "",
    customerId: "",
    lines: [{ kind: "base_freight", label: "Carrier rate", amount: "" }],
    mode: "margin",
    value: "",
    tariffVersionIds: [],
  };
}

export type CalcInput = {
  name: string;
  customerId?: string;
  tariffVersionIds?: string[];
  lines: { kind: CostKind; label: string; amountCents: number }[];
  pricing:
    | { mode: "markup"; rateBp: number }
    | { mode: "margin"; rateBp: number }
    | { mode: "contribution"; amountCents: number }
    | { mode: "price"; amountCents: number };
};

export type CalcFormErrors = Record<string, string>;

export type CalcBuild =
  | { ok: true; input: CalcInput; preview: CalculationResult }
  | { ok: false; errors: CalcFormErrors };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checks the typed values, builds the API input and runs the engine for the preview. */
export function buildCalculation(values: CalcFormValues): CalcBuild {
  const errors: CalcFormErrors = {};
  const name = values.name.trim();
  if (name === "") errors["name"] = "Give the calculation a name, for example the lane.";
  if (name.length > 120) errors["name"] = "Use at most 120 characters.";
  if (values.customerId !== "" && !UUID.test(values.customerId)) {
    errors["customerId"] = "Choose a customer from the list.";
  }
  if (values.lines.length === 0) errors["lines"] = "Add at least one cost line.";
  if (values.lines.length > 50) errors["lines"] = "Use at most 50 cost lines.";

  const lines: CalcInput["lines"] = [];
  values.lines.forEach((line, index) => {
    const label = line.label.trim();
    const amountCents = parseUsd(line.amount);
    if (!(COST_KINDS as readonly string[]).includes(line.kind)) {
      errors[`lines.${index}.kind`] = "Choose a cost type.";
    }
    if (label === "" || label.length > 120) errors[`lines.${index}.label`] = "Describe this line.";
    if (amountCents === undefined) {
      errors[`lines.${index}.amount`] = "Enter an amount like 850 or 1,250.50.";
    }
    if (label !== "" && label.length <= 120 && amountCents !== undefined) {
      lines.push({ kind: line.kind, label, amountCents });
    }
  });

  let pricing: CalcInput["pricing"] | undefined;
  if (values.mode === "markup" || values.mode === "margin") {
    const rateBp = parsePercent(values.value);
    if (rateBp === undefined) errors["value"] = "Enter a percentage like 15 or 12.5.";
    else if (values.mode === "margin" && rateBp >= 10_000) {
      errors["value"] = "A margin of 100 % or more is not possible.";
    } else pricing = { mode: values.mode, rateBp };
  } else {
    const amountCents = parseUsd(values.value);
    if (amountCents === undefined) errors["value"] = "Enter an amount like 1,035 or 1,058.82.";
    else pricing = { mode: values.mode, amountCents };
  }

  if (Object.keys(errors).length > 0 || pricing === undefined) return { ok: false, errors };
  try {
    const preview = calculate({
      lines: lines.map((line) => ({
        kind: line.kind,
        label: line.label,
        amount: line.amountCents,
      })),
      pricing:
        pricing.mode === "markup"
          ? { mode: "markup", rate: pricing.rateBp }
          : pricing.mode === "margin"
            ? { mode: "margin", rate: pricing.rateBp }
            : pricing.mode === "contribution"
              ? { mode: "contribution", amount: pricing.amountCents }
              : { mode: "price", amount: pricing.amountCents },
    });
    const input: CalcInput = {
      name,
      lines,
      pricing,
      ...(values.customerId === "" ? {} : { customerId: values.customerId }),
      ...(values.tariffVersionIds.length === 0
        ? {}
        : { tariffVersionIds: values.tariffVersionIds }),
    };
    return { ok: true, input, preview };
  } catch (error) {
    if (error instanceof MoneyError) return { ok: false, errors: { value: error.message } };
    throw error;
  }
}

/** Reads the form values that the browser sends as one JSON field. Anything unexpected is dropped. */
export function parseCalcPayload(text: string): CalcFormValues {
  const empty = emptyCalcForm();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return empty;
  }
  if (typeof raw !== "object" || raw === null) return empty;
  const value = raw as Record<string, unknown>;
  const str = (input: unknown): string => (typeof input === "string" ? input : "");
  const lines = Array.isArray(value["lines"])
    ? (value["lines"] as unknown[]).slice(0, 60).map((entry) => {
        const line = (typeof entry === "object" && entry !== null ? entry : {}) as Record<
          string,
          unknown
        >;
        return {
          kind: str(line["kind"]) as CostKind,
          label: str(line["label"]),
          amount: str(line["amount"]),
        };
      })
    : empty.lines;
  const mode = (PRICING_MODES as readonly string[]).includes(str(value["mode"]))
    ? (str(value["mode"]) as PricingMode)
    : empty.mode;
  return {
    name: str(value["name"]),
    customerId: str(value["customerId"]),
    lines,
    mode,
    value: str(value["value"]),
    tariffVersionIds: Array.isArray(value["tariffVersionIds"])
      ? (value["tariffVersionIds"] as unknown[])
          .filter((id): id is string => typeof id === "string" && UUID.test(id))
          .slice(0, 10)
      : [],
  };
}
