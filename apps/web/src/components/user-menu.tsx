"use client";

import { Check, LogOut } from "lucide-react";
import { useTheme } from "next-themes";
import { useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@loadlane/ui";

const THEMES = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
] as const;

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase());
  return letters.join("") || "?";
}

/** The person's menu: who is signed in, the theme, and sign out. */
export function UserMenu({ name, email }: { name: string; email: string }) {
  const { theme, setTheme } = useTheme();
  const signOutRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <form ref={signOutRef} action="/logout" method="post" hidden />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Account menu for ${name}`}
            className="flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left text-sm hover:bg-muted"
          >
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground"
            >
              {initials(name)}
            </span>
            <span className="hidden min-w-0 lg:block">
              <span className="block truncate font-medium">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{email}</span>
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="min-w-60">
          <DropdownMenuLabel>
            <span className="block text-sm font-semibold text-foreground">{name}</span>
            <span className="block font-normal">{email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          {THEMES.map(([value, label]) => (
            <DropdownMenuItem key={value} onSelect={() => setTheme(value)}>
              <span className="flex-1">{label}</span>
              {theme === value ? (
                <Check aria-label="Selected" className="size-4 text-positive" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => signOutRef.current?.requestSubmit()}>
            <LogOut aria-hidden="true" className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
