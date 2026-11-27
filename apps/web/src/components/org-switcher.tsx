"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@loadlane/ui";
import { switchOrganizationAction } from "../app/actions";

export interface SwitcherOrganization {
  id: string;
  name: string;
}

/** Shows the active organization and lets the person switch to another one or create one. */
export function OrgSwitcher({
  organizations,
  activeId,
}: {
  organizations: SwitcherOrganization[];
  activeId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const active = organizations.find((organization) => organization.id === activeId);

  function choose(id: string) {
    if (id === activeId || !inputRef.current) return;
    inputRef.current.value = id;
    formRef.current?.requestSubmit();
  }

  return (
    <>
      <form ref={formRef} action={switchOrganizationAction} hidden>
        <input ref={inputRef} type="hidden" name="organizationId" />
      </form>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Organization: ${active?.name ?? "none"}. Switch organization`}
            className="flex w-full min-w-40 items-center justify-between gap-2 rounded-control border border-border bg-background px-3 py-2 text-left text-sm font-medium hover:border-muted-foreground"
          >
            <span className="truncate">{active?.name ?? "Choose organization"}</span>
            <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuLabel>Your organizations</DropdownMenuLabel>
          {organizations.map((organization) => (
            <DropdownMenuItem key={organization.id} onSelect={() => choose(organization.id)}>
              <span className="min-w-0 flex-1 truncate">{organization.name}</span>
              {organization.id === activeId ? (
                <Check aria-label="Current organization" className="size-4 text-positive" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href="/onboarding">
              <Plus aria-hidden="true" className="size-4" />
              Create organization
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
