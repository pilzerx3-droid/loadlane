import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-control bg-muted", className)}
      {...props}
    />
  );
}

/** What a page shows when there is nothing to list yet. It says what is missing and what to do. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-card border border-dashed border-border px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? <div className="mb-1 text-muted-foreground [&_svg]:size-7">{icon}</div> : null}
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {description ? (
        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** Title of a page with an optional description and actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[clamp(1.375rem,3vw,1.875rem)] leading-tight font-semibold tracking-tight">
          {title}
        </h1>
        {description ? <p className="mt-1 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
