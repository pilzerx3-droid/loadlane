"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { COST_KINDS, COST_KIND_LABELS, TARIFF_UNITS, TARIFF_UNIT_LABELS } from "@loadlane/shared";
import { Button, Card, Input, NativeSelect } from "@loadlane/ui";
import { saveTariffAction, type TariffFormState } from "../app/tariff-actions";
import { buildTariff, type TariffFormValues } from "../lib/tariff-form";
import { Notice } from "./notices";

export interface PartyOption {
  id: string;
  label: string;
}

/**
 * Rate lines of a price list. `tariffId` empty creates a new list; otherwise the same form adds a
 * new version (name and party are fixed then). Saved versions never change.
 */
export function TariffForm({
  tariffId,
  initial,
  customers,
  carriers,
}: {
  tariffId: string;
  initial: TariffFormValues;
  customers: PartyOption[];
  carriers: PartyOption[];
}) {
  const [state, action, pending] = useActionState(saveTariffAction.bind(null, tariffId), {
    payload: "",
    errors: {},
  } as TariffFormState);
  const [values, setValues] = useState<TariffFormValues>(initial);
  const creating = tariffId === "";
  const errors = state.errors;
  const set = (change: Partial<TariffFormValues>) =>
    setValues((current) => ({ ...current, ...change }));
  const setLine = (index: number, change: Partial<TariffFormValues["lines"][number]>) =>
    set({ lines: values.lines.map((line, i) => (i === index ? { ...line, ...change } : line)) });
  const parties = values.kind === "sell" ? customers : carriers;
  const ready = buildTariff(values, creating).ok;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="payload" value={JSON.stringify(values)} />
      {state.message ? <Notice>{state.message}</Notice> : null}
      <Card className="space-y-4 p-5">
        {creating ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="tariff-name" className="mb-1 block text-[13px] font-semibold">
                Name
              </label>
              <Input
                id="tariff-name"
                value={values.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Acme 2030"
              />
              {errors["name"] ? <p className="mt-1 text-xs text-danger">{errors["name"]}</p> : null}
            </div>
            <div>
              <label htmlFor="tariff-kind" className="mb-1 block text-[13px] font-semibold">
                Type
              </label>
              <NativeSelect
                id="tariff-kind"
                value={values.kind}
                onChange={(e) =>
                  set({ kind: e.target.value === "buy" ? "buy" : "sell", partyId: "" })
                }
              >
                <option value="sell">Sell: what a customer pays us</option>
                <option value="buy">Buy: what we pay a carrier</option>
              </NativeSelect>
            </div>
            <div>
              <label htmlFor="tariff-party" className="mb-1 block text-[13px] font-semibold">
                {values.kind === "sell" ? "Customer (optional)" : "Carrier (optional)"}
              </label>
              <NativeSelect
                id="tariff-party"
                value={values.partyId}
                onChange={(e) => set({ partyId: e.target.value })}
              >
                <option value="">Any</option>
                {parties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="tariff-from" className="mb-1 block text-[13px] font-semibold">
              Rates apply from
            </label>
            <Input
              id="tariff-from"
              type="date"
              value={values.validFrom}
              onChange={(e) => set({ validFrom: e.target.value })}
            />
            {errors["validFrom"] ? (
              <p className="mt-1 text-xs text-danger">{errors["validFrom"]}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="tariff-note" className="mb-1 block text-[13px] font-semibold">
              Note (optional)
            </label>
            <Input
              id="tariff-note"
              value={values.note}
              onChange={(e) => set({ note: e.target.value })}
            />
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">Rate lines</h2>
        {errors["lines"] ? <p className="text-xs text-danger">{errors["lines"]}</p> : null}
        {values.lines.map((line, index) => (
          <div
            key={index}
            className="grid grid-cols-2 items-start gap-2 sm:grid-cols-[11rem_1fr_9rem_7rem_7rem_auto]"
          >
            <NativeSelect
              aria-label={`Cost type of line ${index + 1}`}
              value={line.kind}
              onChange={(e) => setLine(index, { kind: e.target.value as typeof line.kind })}
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
                onChange={(e) => setLine(index, { label: e.target.value })}
                placeholder="Description"
              />
              {errors[`lines.${index}.label`] ? (
                <p className="mt-1 text-xs text-danger">{errors[`lines.${index}.label`]}</p>
              ) : null}
            </div>
            <NativeSelect
              aria-label={`Unit of line ${index + 1}`}
              value={line.unit}
              onChange={(e) => setLine(index, { unit: e.target.value as typeof line.unit })}
            >
              {TARIFF_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {TARIFF_UNIT_LABELS[unit]}
                </option>
              ))}
            </NativeSelect>
            <div>
              <Input
                aria-label={`Rate of line ${index + 1} in dollars`}
                inputMode="decimal"
                value={line.rate}
                onChange={(e) => setLine(index, { rate: e.target.value })}
                placeholder="Rate $"
              />
              {errors[`lines.${index}.rate`] ? (
                <p className="mt-1 text-xs text-danger">{errors[`lines.${index}.rate`]}</p>
              ) : null}
            </div>
            <div>
              <Input
                aria-label={`Minimum charge of line ${index + 1} in dollars`}
                inputMode="decimal"
                value={line.minimum}
                onChange={(e) => setLine(index, { minimum: e.target.value })}
                placeholder="Min. $"
              />
              {errors[`lines.${index}.minimum`] ? (
                <p className="mt-1 text-xs text-danger">{errors[`lines.${index}.minimum`]}</p>
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
            set({
              lines: [
                ...values.lines,
                { kind: "accessorial", label: "", unit: "flat", rate: "", minimum: "" },
              ],
            })
          }
        >
          <Plus aria-hidden="true" /> Add rate line
        </Button>
      </Card>

      <Button type="submit" variant="solid" disabled={pending || !ready}>
        {pending ? "Saving…" : creating ? "Create price list" : "Save as a new version"}
      </Button>
      {!creating ? (
        <p className="text-xs text-muted-foreground">
          Saved versions never change. A new version applies from its start date; calculations made
          earlier keep the version they used.
        </p>
      ) : null}
    </form>
  );
}
