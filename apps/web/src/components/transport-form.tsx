"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, FieldMessage, Input, Label, NativeSelect } from "@loadlane/ui";
import { saveTransportAction, type TransportFormState } from "../app/transport-actions";
import { emptyStop, type StopValues, type TransportFormValues } from "../lib/transport-form";
import { Notice } from "./notices";

export interface Option {
  id: string;
  label: string;
}

const MAX_STOPS = 20;

function Field({
  id,
  label,
  error,
  hint,
  optional,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
      </Label>
      {children}
      {error || hint ? (
        <FieldMessage id={`${id}-message`} invalid={Boolean(error)}>
          {error ?? hint}
        </FieldMessage>
      ) : null}
    </div>
  );
}

/** Create or edit a transport with its stops. Times are typed in the time zone of each stop's location. */
export function TransportForm({
  id,
  values,
  customers,
  carriers,
  locations,
}: {
  /** Empty for a new transport. */
  id: string;
  values: TransportFormValues;
  customers: Option[];
  carriers: Option[];
  locations: Option[];
}) {
  const initial: TransportFormState = { values, errors: {} };
  const [state, action, pending] = useActionState(saveTransportAction.bind(null, id), initial);
  const [stops, setStops] = useState<StopValues[]>(state.values.stops);
  const errors = state.errors;
  const v = state.values;

  const update = (index: number, change: Partial<StopValues>) =>
    setStops((current) =>
      current.map((stop, position) => (position === index ? { ...stop, ...change } : stop)),
    );

  const invalid = (key: string) => (errors[key] ? true : undefined);
  const describedBy = (key: string) => (errors[key] ? `${key}-message` : undefined);

  return (
    <form action={action} className="max-w-3xl space-y-6" noValidate>
      {v.quoteId !== "" ? <input type="hidden" name="quoteId" value={v.quoteId} /> : null}
      {v.quoteId !== "" ? (
        <Notice>
          This transport is made from an accepted quote. Add the stops and times; the quote is
          linked when you save.
        </Notice>
      ) : null}
      {state.message ? <Notice>{state.message}</Notice> : null}
      {errors["stops"] ? <Notice>{errors["stops"]}</Notice> : null}

      <Card className="space-y-5 p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="customerId" label="Customer" error={errors["customerId"]}>
            <NativeSelect
              id="customerId"
              name="customerId"
              defaultValue={v.customerId}
              aria-invalid={invalid("customerId")}
              aria-describedby={describedBy("customerId")}
            >
              <option value="">Choose a customer</option>
              {customers.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            id="carrierId"
            label="Carrier"
            optional
            error={errors["carrierId"]}
            hint="Needed before the transport can be assigned."
          >
            <NativeSelect
              id="carrierId"
              name="carrierId"
              defaultValue={v.carrierId}
              aria-invalid={invalid("carrierId")}
              aria-describedby={describedBy("carrierId")}
            >
              <option value="">Not assigned yet</option>
              {carriers.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            id="customerReference"
            label="Customer reference"
            optional
            error={errors["customerReference"]}
          >
            <Input
              id="customerReference"
              name="customerReference"
              maxLength={80}
              defaultValue={v.customerReference}
              autoComplete="off"
            />
          </Field>
          <Field id="purchaseOrder" label="Purchase order" optional error={errors["purchaseOrder"]}>
            <Input
              id="purchaseOrder"
              name="purchaseOrder"
              maxLength={80}
              defaultValue={v.purchaseOrder}
              autoComplete="off"
            />
          </Field>
          <Field id="weightLb" label="Weight (lb)" optional error={errors["weightLb"]}>
            <Input
              id="weightLb"
              name="weightLb"
              inputMode="decimal"
              defaultValue={v.weightLb}
              autoComplete="off"
              aria-invalid={invalid("weightLb")}
              aria-describedby={describedBy("weightLb")}
            />
          </Field>
          <Field id="pieces" label="Pieces" optional error={errors["pieces"]}>
            <Input
              id="pieces"
              name="pieces"
              inputMode="numeric"
              defaultValue={v.pieces}
              autoComplete="off"
              aria-invalid={invalid("pieces")}
              aria-describedby={describedBy("pieces")}
            />
          </Field>
        </div>
        <Field id="notes" label="Notes" optional error={errors["notes"]}>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            maxLength={2000}
            defaultValue={v.notes}
            className="w-full rounded-control border border-border bg-card px-3 py-2 text-sm"
          />
        </Field>
      </Card>

      <section aria-labelledby="stops-heading" className="space-y-4">
        <h2 id="stops-heading" className="text-base font-semibold tracking-tight">
          Stops
        </h2>
        {stops.map((stop, index) => {
          const key = (field: string) => `stops.${index}.${field}`;
          return (
            <Card key={index} className="space-y-4 p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-sm font-semibold">Stop {index + 1}</p>
                {stops.length > 2 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setStops((current) => current.filter((_, p) => p !== index))}
                  >
                    <Trash2 aria-hidden="true" /> Remove
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id={key("type")} label="Type" error={errors[key("type")]}>
                  <NativeSelect
                    id={key("type")}
                    name={key("type")}
                    value={stop.type}
                    onChange={(event) =>
                      update(index, {
                        type: event.target.value === "delivery" ? "delivery" : "pickup",
                      })
                    }
                  >
                    <option value="pickup">Pickup</option>
                    <option value="delivery">Delivery</option>
                  </NativeSelect>
                </Field>
                <Field id={key("locationId")} label="Location" error={errors[key("locationId")]}>
                  <NativeSelect
                    id={key("locationId")}
                    name={key("locationId")}
                    value={stop.locationId}
                    onChange={(event) => update(index, { locationId: event.target.value })}
                    aria-invalid={invalid(key("locationId"))}
                    aria-describedby={describedBy(key("locationId"))}
                  >
                    <option value="">Choose a location</option>
                    {locations.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field
                  id={key("start")}
                  label="Window starts"
                  error={errors[key("start")]}
                  hint="Local time at the location."
                >
                  <Input
                    id={key("start")}
                    name={key("start")}
                    type="datetime-local"
                    value={stop.start}
                    onChange={(event) => update(index, { start: event.target.value })}
                    aria-invalid={invalid(key("start"))}
                    aria-describedby={`${key("start")}-message`}
                  />
                </Field>
                <Field id={key("end")} label="Window ends" error={errors[key("end")]}>
                  <Input
                    id={key("end")}
                    name={key("end")}
                    type="datetime-local"
                    value={stop.end}
                    onChange={(event) => update(index, { end: event.target.value })}
                    aria-invalid={invalid(key("end"))}
                    aria-describedby={describedBy(key("end"))}
                  />
                </Field>
                <Field
                  id={key("reference")}
                  label="Appointment number"
                  optional
                  error={errors[key("reference")]}
                >
                  <Input
                    id={key("reference")}
                    name={key("reference")}
                    maxLength={80}
                    value={stop.reference}
                    onChange={(event) => update(index, { reference: event.target.value })}
                    autoComplete="off"
                  />
                </Field>
              </div>
            </Card>
          );
        })}
        {stops.length < MAX_STOPS ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setStops((current) => [...current, emptyStop("delivery")])}
          >
            <Plus aria-hidden="true" /> Add stop
          </Button>
        ) : null}
        <p className="text-sm text-muted-foreground">
          The first stop must be a pickup and the last a delivery.
        </p>
      </section>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : id === "" ? "Create transport" : "Save changes"}
        </Button>
        <Button asChild variant="outline">
          <a href={id === "" ? "/transports" : `/transports/${id}`}>Cancel</a>
        </Button>
      </div>
    </form>
  );
}
