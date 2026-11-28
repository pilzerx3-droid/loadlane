"use client";

import { useState, useTransition } from "react";
import { Button, Card, Input, NativeSelect } from "@loadlane/ui";
import { isCostKind } from "@loadlane/shared";
import { applyTariffAction } from "../app/tariff-actions";
import type { CalcLineValues } from "../lib/calculation-form";
import { Notice } from "./notices";

export interface TariffOption {
  id: string;
  label: string;
}

export interface TariffFill {
  lines: CalcLineValues[];
  versionId: string;
  description: string;
}

const UNITS = [
  ["mile", "Miles"],
  ["pallet", "Pallets"],
  ["lb", "Pounds"],
  ["hour", "Hours"],
] as const;

/**
 * Fills cost lines from a price list for one shipment. The price list needs a quantity for every
 * unit it uses; nothing is guessed. The exact version used is recorded when the calculation is saved.
 */
export function CalculationTariffPanel({
  tariffs,
  onFill,
}: {
  tariffs: TariffOption[];
  onFill: (fill: TariffFill) => void;
}) {
  const [tariffId, setTariffId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  if (tariffs.length === 0) return null;

  function fill() {
    const numbers: Record<string, number> = {};
    for (const [unit] of UNITS) {
      const text = quantities[unit]?.trim() ?? "";
      if (text === "") continue;
      const value = Number(text.replace(/,/g, ""));
      if (!Number.isFinite(value) || value < 0) {
        setMessage(`Enter a number for ${unit}s, for example 412.5.`);
        return;
      }
      numbers[unit] = value;
    }
    startTransition(async () => {
      const result = await applyTariffAction(tariffId, date, numbers);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setMessage(undefined);
      const { result: applied } = result;
      onFill({
        versionId: applied.versionId,
        description: `${applied.tariffName}, version ${applied.version} (from ${applied.validFrom})`,
        lines: applied.lines.map((line) => ({
          kind: isCostKind(line.kind) ? line.kind : "other",
          label: line.minimumApplied ? `${line.label} (minimum charge)` : line.label,
          amount: (line.amountCents / 100).toFixed(2),
        })),
      });
    });
  }

  return (
    <Card className="space-y-3 p-5" aria-label="Fill from a price list">
      <h2 className="text-base font-semibold">Fill from a price list (optional)</h2>
      <p className="text-sm text-muted-foreground">
        Pick a price list and enter the quantities. The cost lines are added below and you can still
        edit them. The version of the price list is recorded with the saved calculation.
      </p>
      {message ? <Notice>{message}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <NativeSelect
          aria-label="Price list"
          value={tariffId}
          onChange={(e) => setTariffId(e.target.value)}
        >
          <option value="">Choose a price list</option>
          {tariffs.map((tariff) => (
            <option key={tariff.id} value={tariff.id}>
              {tariff.label}
            </option>
          ))}
        </NativeSelect>
        <Input
          aria-label="Shipment date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {UNITS.map(([unit, label]) => (
          <Input
            key={unit}
            aria-label={label}
            inputMode="decimal"
            placeholder={label}
            value={quantities[unit] ?? ""}
            onChange={(e) => setQuantities((current) => ({ ...current, [unit]: e.target.value }))}
          />
        ))}
      </div>
      <Button type="button" variant="outline" disabled={pending || tariffId === ""} onClick={fill}>
        {pending ? "Pricing…" : "Add cost lines from this price list"}
      </Button>
    </Card>
  );
}
