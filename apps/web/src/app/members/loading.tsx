import { Card, Skeleton } from "@loadlane/ui";

/** Shown while the members are loaded: placeholders in the shape of the table. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading members" className="p-4 lg:p-8">
      <Skeleton className="mb-2 h-8 w-48" />
      <Skeleton className="mb-6 h-4 w-72" />
      <Card className="space-y-3">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </Card>
    </div>
  );
}
