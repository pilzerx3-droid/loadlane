import { describe, expect, it } from "vitest";
import {
  buildTariff,
  emptyTariffForm,
  parseTariffPayload,
  type TariffFormValues,
} from "./tariff-form";

const today = "2030-01-01";
const valid: TariffFormValues = {
  name: "Acme 2030",
  kind: "sell",
  partyId: "",
  validFrom: "2030-01-01",
  note: " Initial ",
  lines: [
    { kind: "mileage", label: "Line haul", unit: "mile", rate: "2.35", minimum: "" },
    { kind: "loading", label: "Pallets", unit: "pallet", rate: "12.50", minimum: "$50" },
  ],
};

describe("buildTariff", () => {
  it("builds the API input with cents and optional minimums", () => {
    const built = buildTariff(valid);
    expect(built.ok && built.input).toEqual({
      name: "Acme 2030",
      kind: "sell",
      validFrom: "2030-01-01",
      note: "Initial",
      lines: [
        { kind: "mileage", label: "Line haul", unit: "mile", rateCents: 235 },
        {
          kind: "loading",
          label: "Pallets",
          unit: "pallet",
          rateCents: 1_250,
          minimumCents: 5_000,
        },
      ],
    });
  });

  it("puts the party on the right field for the type", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const sell = buildTariff({ ...valid, partyId: id });
    expect(sell.ok && sell.input.customerId).toBe(id);
    const buy = buildTariff({ ...valid, kind: "buy", partyId: id });
    expect(buy.ok && buy.input.carrierId).toBe(id);
    expect(buy.ok && "customerId" in buy.input).toBe(false);
  });

  it("reports problems field by field in plain words", () => {
    const built = buildTariff({
      ...emptyTariffForm(today),
      validFrom: "",
      lines: [{ kind: "toll", label: "", unit: "flat", rate: "lots", minimum: "x" }],
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(Object.keys(built.errors).sort()).toEqual([
      "lines.0.label",
      "lines.0.minimum",
      "lines.0.rate",
      "name",
      "validFrom",
    ]);
  });

  it("does not ask for a name when adding a version", () => {
    expect(buildTariff({ ...valid, name: "" }, false).ok).toBe(true);
    expect(buildTariff({ ...valid, name: "" }, true).ok).toBe(false);
  });

  it("needs at least one rate line", () => {
    const built = buildTariff({ ...valid, lines: [] });
    expect(!built.ok && built.errors["lines"]).toBeTruthy();
  });
});

describe("parseTariffPayload", () => {
  it("round-trips the form values and falls back safely", () => {
    expect(parseTariffPayload(JSON.stringify(valid), today)).toEqual(valid);
    expect(parseTariffPayload("not json", today)).toEqual(emptyTariffForm(today));
    const odd = parseTariffPayload(
      JSON.stringify({ ...valid, kind: "x", lines: [{ kind: "bribe", unit: "furlong" }] }),
      today,
    );
    expect(odd.kind).toBe("sell");
    expect(odd.lines[0]).toMatchObject({ kind: "other", unit: "flat" });
  });
});
