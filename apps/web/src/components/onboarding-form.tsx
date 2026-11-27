"use client";

import { useActionState, useEffect, useState } from "react";
import { Button, FieldMessage, Input, Label, NativeSelect } from "@loadlane/ui";
import { createOrganizationAction, type CreateOrganizationState } from "../app/actions";
import { Notice } from "./notices";

const US_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

const INITIAL: CreateOrganizationState = {
  values: { name: "", timezone: "America/Chicago" },
  fieldErrors: {},
};

/** Form for the first (or another) organization. Works without JavaScript; the action validates on the server. */
export function OnboardingForm({ timeZones }: { timeZones: string[] }) {
  const [state, action, pending] = useActionState(createOrganizationAction, INITIAL);
  const [timezone, setTimezone] = useState(state.values.timezone);

  // Preselect the visitor's own time zone when it is one we offer.
  useEffect(() => {
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (own && timeZones.includes(own)) setTimezone(own);
  }, [timeZones]);

  const others = timeZones.filter((zone) => !US_ZONES.includes(zone));

  return (
    <form action={action} className="space-y-5" noValidate>
      {state.message ? <Notice>{state.message}</Notice> : null}

      <div>
        <Label htmlFor="name">Organization name</Label>
        <Input
          id="name"
          name="name"
          autoComplete="organization"
          required
          minLength={2}
          maxLength={80}
          defaultValue={state.values.name}
          aria-invalid={state.fieldErrors.name ? true : undefined}
          aria-describedby="name-hint"
        />
        <FieldMessage id="name-hint" invalid={Boolean(state.fieldErrors.name)}>
          {state.fieldErrors.name ?? "The name your team and carriers will see."}
        </FieldMessage>
      </div>

      <div>
        <Label htmlFor="timezone">Time zone</Label>
        <NativeSelect
          id="timezone"
          name="timezone"
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          aria-invalid={state.fieldErrors.timezone ? true : undefined}
          aria-describedby="timezone-hint"
        >
          <optgroup label="United States">
            {US_ZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace("_", " ")}
              </option>
            ))}
          </optgroup>
          <optgroup label="All time zones">
            {others.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </optgroup>
        </NativeSelect>
        <FieldMessage id="timezone-hint" invalid={Boolean(state.fieldErrors.timezone)}>
          {state.fieldErrors.timezone ?? "Used for pickup and delivery times."}
        </FieldMessage>
      </div>

      <p className="text-sm text-muted-foreground">
        New organizations use miles, pounds, US dollars and MM/DD/YYYY dates.
      </p>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
