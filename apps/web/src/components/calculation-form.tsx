"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { COST_KINDS, COST_KIND_LABELS } from "@loadlane/shared";
import { Button, Card, Input, NativeSelect } from "@loadlane/ui";
import { saveCalculationAction, type CalcFormState } from "../app/calculation-actions";
import {
  PRICING_MODES,
  PRICING_MODE_LABELS,
  buildCalculation,
  emptyCalcForm,
  parseCalcPayload,
  type CalcFormValues,
  type PricingMode,
} from "../lib/calculation-form";
import { CalculationTariffPanel, type TariffOption } from "./calculation-tariff-panel";
import { Notice } from "./notices";
import { PriceSummary } from "./price-summary";

export interface CustomerOption {
  id: string;
  label: string;
}

/** The freight calculator: cost lines, a pricing method and a live result from the same engine the API uses. */
export function CalculationForm({
  customers,
  tariffs = [],
}: {
  customers: CustomerOption[];
  tariffs?: TariffOption[];
}) {
  const [filledFrom, setFilledFrom] = useState<string[]>([]);
  const initial: CalcFormState = { payload: "", errors: {} };
  const [state, action, pending] = useActionState(saveCalculationAction, initial);
  const [values, setValues] = useState<CalcFormValues>(
    state.payload ? parseCalcPayload(state.payload) : emptyCalcForm(),
  );
  const built = useMemo(() => buildCalculation(values), [values]);
  const errors = state.errors;
  const set = (change: Partial<CalcFormValues>) =>
    setValues((current) => ({ ...current, ...change }));
  const setLine = (index: number, change: Partial<CalcFormValues["lines"][number]>) =>
    set({ lines: values.lines.map((line, i) => (i === index ? { ...line, ...change } : line)) });
  const valueLabel =
    values.mode === "markup" || values.mode === "margin" ? "Percentage" : "Amount in dollars";

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="payload" value={JSON.stringify(values)} />
      {state.message ? <Notice>{state.message}</Notice> : null}

      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="calc-name" className="mb-1 block text-[13px] font-semibold">
              Name
            </label>
            <Input
              id="calc-name"
              value={values.name}
              onChange={(event) => set({ name: event.target.value })}
              placeholder="Dallas, TX to Houston, TX"
              aria-invalid={errors["name"] ? true : undefined}
            />
            {errors["name"] ? <p className="mt-1 text-xs text-danger">{errors["name"]}</p> : null}
          </div>
          <div>
            <label htmlFor="calc-customer" className="mb-1 block text-[13px] font-semibold">
              Customer (optional)
            </label>
            <NativeSelect
              id="calc-customer"
              value={values.customerId}
              onChange={(event) => set({ customerId: event.target.value })}
            >
              <option value="">No customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      </Card>

      <CalculationTariffPanel
        tariffs={tariffs}
        onFill={(fill) => {
          const existing = values.lines.filter(
            (line) => line.label.trim() !== "" || line.amount.trim() !== "",
          );
          set({
            lines: [...existing, ...fill.lines],
            tariffVersionIds: values.tariffVersionIds.includes(fill.versionId)
              ? values.tariffVersionIds
              : [...values.tariffVersionIds, fill.versionId],
          });
          setFilledFrom((current) => [...current, fill.description]);
        }}
      />
      {filledFrom.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Cost lines were filled from: {filledFrom.join("; ")}. These versions are recorded when you
          save.
        </p>
      ) : null}

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">Cost lines</h2>
        {errors["lines"] ? <p className="text-xs text-danger">{errors["lines"]}</p> : null}
        {values.lines.map((line, index) => (
          <div
            key={index}
            className="grid grid-cols-[1fr_auto] items-start gap-2 sm:grid-cols-[12rem_1fr_9rem_auto]"
          >
            <NativeSelect
              aria-label={`Cost type of line ${index + 1}`}
              value={line.kind}
              onChange={(event) => setLine(index, { kind: event.target.value as typeof line.kind })}
            >
              {COST_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {COST_KIND_LABELS[kind]}
                </option>
              ))}
            </NativeSelect>
            <div className="col-span-2 sm:col-span-1">
              <Input
                aria-label={`Description of line ${index + 1}`}
                value={line.label}
                onChange={(event) => setLine(index, { label: event.target.value })}
                placeholder="Description"
                aria-invalid={errors[`lines.${index}.label`] ? true : undefined}
              />
              {errors[`lines.${index}.label`] ? (
                <p className="mt-1 text-xs text-danger">{errors[`lines.${index}.label`]}</p>
              ) : null}
            </div>
            <div>
              <Input
                aria-label={`Amount of line ${index + 1} in dollars`}
                inputMode="decimal"
                value={line.amount}
                onChange={(event) => setLine(index, { amount: event.target.value })}
                placeholder="$ 0.00"
                aria-invalid={errors[`lines.${index}.amount`] ? true : undefined}
              />
              {errors[`lines.${index}.amount`] ? (
                <p className="mt-1 text-xs text-danger">{errors[`lines.${index}.amount`]}</p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove line ${index + 1}`}
              onClick={() => set({ lines: values.lines.filter((_, i) => i !== index) })}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            set({ lines: [...values.lines, { kind: "accessorial", label: "", amount: "" }] })
          }
        >
          <Plus aria-hidden="true" /> Add cost line
        </Button>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">Selling price</h2>
        <p className="text-sm text-muted-foreground">
          Choose how the price is set. Markup is a percentage of cost, margin a percentage of the
          price: 15 % of each gives different prices.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="calc-mode" className="mb-1 block text-[13px] font-semibold">
              Method
            </label>
            <NativeSelect
              id="calc-mode"
              value={values.mode}
              onChange={(event) => set({ mode: event.target.value as PricingMode })}
            >
              {PRICING_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {PRICING_MODE_LABELS[mode]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <label htmlFor="calc-value" className="mb-1 block text-[13px] font-semibold">
              {valueLabel}
            </label>
            <Input
              id="calc-value"
              inputMode="decimal"
              value={values.value}
              onChange={(event) => set({ value: event.target.value })}
              aria-invalid={errors["value"] ? true : undefined}
            />
            {errors["value"] ? <p className="mt-1 text-xs text-danger">{errors["value"]}</p> : null}
          </div>
        </div>
      </Card>

      {built.ok ? (
        <PriceSummary
          figures={{
            costCents: built.preview.analysis.cost,
            priceCents: built.preview.analysis.price,
            contributionCents: built.preview.analysis.contribution,
            markupBp: built.preview.analysis.markup,
            marginBp: built.preview.analysis.margin,
          }}
        />
      ) : (
        <Card className="p-5 text-sm text-muted-foreground" aria-live="polite">
          The result appears here as soon as every field is filled in correctly.
        </Card>
      )}

      <Button type="submit" variant="solid" disabled={pending || !built.ok}>
        {pending ? "Saving…" : "Save calculation"}
      </Button>
    </form>
  );
}
