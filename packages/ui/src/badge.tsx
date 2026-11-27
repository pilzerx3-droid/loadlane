import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "./cn";

/** A small status chip. The text always says what the status is; color only supports it. */
export const badgeVariants = cva("inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-xs", {
  variants: {
    variant: {
      neutral: "bg-muted text-foreground",
      positive: "bg-accent/25 text-positive",
      warning: "bg-warning/20 text-warning",
      danger: "bg-danger/15 text-danger",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
