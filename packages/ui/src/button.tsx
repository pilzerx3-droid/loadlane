import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "./cn";

export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control font-mono font-semibold",
    "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "border border-accent bg-accent text-accent-foreground hover:brightness-95",
        outline:
          "border border-border bg-transparent text-foreground hover:border-muted-foreground",
        solid: "border border-foreground bg-foreground text-background hover:opacity-90",
        ghost:
          "border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-[13px]",
        lg: "h-12 px-6 text-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element (for example a link) with the button's look. */
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) return <Slot.Root className={classes} {...props} />;
  // A plain button does not submit a form unless it says so.
  return <button type={type ?? "button"} className={classes} {...props} />;
}
