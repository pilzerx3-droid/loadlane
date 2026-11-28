import {
  COST_KINDS,
  TARIFF_UNITS,
  isCostKind,
  isTariffUnit,
  parseUsd,
  type CostKind,
  type TariffUnit,
} from "@loadlane/shared";

// The tariff form: what a person types, and how it becomes the API input.

export interface TariffLineValues {
  kind: CostKind;
  label: string;
  unit: TariffUnit;
  /** Dollars per unit as typed, for example "2.35". */
  rate: string;
  /** Optional minimum charge in dollars. */
  minimum: string;
}

export interface TariffFormValues {
  name: string;
  kind: "sell" | "buy";
  /** Customer id for sell lists, carrier id for buy lists; empty for none. */
  partyId: string;
  validFrom: string;
  note: string;
  lines: TariffLineValues[];
}

export function emptyTariffForm(today: string): TariffFormValues {
  return {
    name: "",
    kind: "sell",
    partyId: "",
    validFrom: today,
    note: "",
    lines: [{ kind: "mileage", label: "Line haul", unit: "mile", rate: "", minimum: "" }],
  };
}

export type TariffInput = {
  name: string;
  kind: "sell" | "buy";
  customerId?: string;
  carrierId?: string;
  validFrom: string;
  note: string;
  lines: {
    kind: CostKind;
    label: string;
    unit: TariffUnit;
    rateCents: number;
    minimumCents?: number;
  }[];
};

export type VersionInput = Pick<TariffInput, "validFrom" | "note" | "lines">;

export type TariffBuild =
  { ok: true; input: TariffInput } | { ok: false; errors: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Checks the typed values and builds the API input. `needsName` is false when adding a version. */
export function buildTariff(values: TariffFormValues, needsName = true): TariffBuild {
  const errors: Record<string, string> = {};
  const name = values.name.trim();
  if (needsName && (name === "" || name.length > 120))
    errors["name"] = "Give the price list a name.";
  if (values.partyId !== "" && !UUID.test(values.partyId))
    errors["partyId"] = "Choose from the list.";
  if (!DATE.test(values.validFrom)) errors["validFrom"] = "Choose the first day these rates apply.";
  if (values.lines.length === 0) errors["lines"] = "Add at least one rate line.";
  if (values.lines.length > 50) errors["lines"] = "Use at most 50 rate lines.";

  const lines: TariffInput["lines"] = [];
  values.lines.forEach((line, index) => {
    const label = line.label.trim();
    const rateCents = parseUsd(line.rate);
    const minimumCents = line.minimum.trim() === "" ? undefined : parseUsd(line.minimum);
    if (!isCostKind(line.kind) || !isTariffUnit(line.unit))
      errors[`lines.${index}.kind`] = "Choose a type and unit.";
    if (label === "" || label.length > 120) errors[`lines.${index}.label`] = "Describe this line.";
    if (rateCents === undefined) errors[`lines.${index}.rate`] = "Enter a rate like 2.35.";
    if (line.minimum.trim() !== "" && minimumCents === undefined) {
      errors[`lines.${index}.minimum`] = "Enter an amount like 50 or leave it empty.";
    }
    if (
      rateCents !== undefined &&
      label !== "" &&
      label.length <= 120 &&
      (line.minimum.trim() === "" || minimumCents !== undefined)
    ) {
      lines.push({
        kind: line.kind,
        label,
        unit: line.unit,
        rateCents,
        ...(minimumCents === undefined ? {} : { minimumCents }),
      });
    }
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      name,
      kind: values.kind,
      ...(values.partyId === ""
        ? {}
        : values.kind === "sell"
          ? { customerId: values.partyId }
          : { carrierId: values.partyId }),
      validFrom: values.validFrom,
      note: values.note.trim(),
      lines,
    },
  };
}

/** Reads the form values the browser sends as one JSON field. Anything unexpected is dropped. */
export function parseTariffPayload(text: string, today: string): TariffFormValues {
  const empty = emptyTariffForm(today);
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
          kind: (COST_KINDS as readonly string[]).includes(str(line["kind"]))
            ? (str(line["kind"]) as CostKind)
            : "other",
          label: str(line["label"]),
          unit: (TARIFF_UNITS as readonly string[]).includes(str(line["unit"]))
            ? (str(line["unit"]) as TariffUnit)
            : "flat",
          rate: str(line["rate"]),
          minimum: str(line["minimum"]),
        };
      })
    : empty.lines;
  return {
    name: str(value["name"]),
    kind: str(value["kind"]) === "buy" ? "buy" : "sell",
    partyId: str(value["partyId"]),
    validFrom: str(value["validFrom"]),
    note: str(value["note"]),
    lines,
  };
}
