import type { ComponentProps } from "react";
import { cn } from "./cn";

const control =
  "h-10 w-full rounded-control border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-50 aria-[invalid=true]:border-danger";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("mb-1 block text-[13px] font-semibold", className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, className)} {...props} />;
}

/** The browser's own select, styled like the other controls. It works without JavaScript. */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(control, className)} {...props} />;
}

/** Text under a field: a hint, or an error when `invalid`. */
export function FieldMessage({
  invalid = false,
  className,
  ...props
}: ComponentProps<"p"> & { invalid?: boolean }) {
  return (
    <p
      role={invalid ? "alert" : undefined}
      className={cn(
        "mt-1 text-[13px]",
        invalid ? "text-danger" : "text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
