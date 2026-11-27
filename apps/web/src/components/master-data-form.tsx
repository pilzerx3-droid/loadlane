"use client";

import { useActionState } from "react";
import { Button, FieldMessage, Input, Label, NativeSelect } from "@loadlane/ui";
import { saveRecordAction, type SaveRecordState } from "../app/master-data-actions";
import type { MasterDataConfig } from "../lib/master-data";
import { Notice } from "./notices";

/** Create or edit form for customers, carriers and locations. Works without JavaScript; the server validates. */
export function MasterDataForm({
  config,
  id,
  values,
}: {
  config: MasterDataConfig;
  /** Empty for a new record. */
  id: string;
  values: Record<string, string>;
}) {
  const initial: SaveRecordState = { values, fieldErrors: {} };
  const [state, action, pending] = useActionState(
    saveRecordAction.bind(null, config.key, id),
    initial,
  );

  return (
    <form action={action} className="max-w-xl space-y-5" noValidate>
      {state.message ? <Notice>{state.message}</Notice> : null}
      {config.fields.map((field) => {
        const error = state.fieldErrors[field.name];
        const hintId = `${field.name}-hint`;
        const common = {
          id: field.name,
          name: field.name,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": field.hint || error ? hintId : undefined,
        } as const;
        const value = state.values[field.name] ?? "";
        return (
          <div key={field.name}>
            <Label htmlFor={field.name}>
              {field.label}
              {field.required ? null : (
                <span className="font-normal text-muted-foreground"> (optional)</span>
              )}
            </Label>
            {field.type === "textarea" ? (
              <textarea
                {...common}
                rows={3}
                maxLength={field.maxLength}
                defaultValue={value}
                className="w-full rounded-control border border-border bg-background px-3 py-2 text-sm"
              />
            ) : field.type === "select" ? (
              <NativeSelect {...common} defaultValue={value || field.options?.[0]?.value}>
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input
                {...common}
                type={field.type}
                required={field.required}
                maxLength={field.maxLength}
                autoComplete={field.autoComplete}
                defaultValue={value}
              />
            )}
            {field.hint || error ? (
              <FieldMessage id={hintId} invalid={Boolean(error)}>
                {error ?? field.hint}
              </FieldMessage>
            ) : null}
          </div>
        );
      })}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : id === "" ? `Add ${config.singular}` : "Save changes"}
        </Button>
        <Button asChild variant="outline">
          <a href={config.path}>Cancel</a>
        </Button>
      </div>
    </form>
  );
}
