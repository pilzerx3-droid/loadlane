import { z } from "zod";
import {
  ALERT_LABELS,
  TRANSPORT_STATUSES,
  formatInZone,
  type AlertCondition,
} from "@loadlane/shared";
import {
  Card,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@loadlane/ui";
import { statusLabel } from "./transport-views";

export const alertListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      reference: z.string(),
      status: z.enum(TRANSPORT_STATUSES),
      conditions: z.array(z.string()),
      customerName: z.string(),
      carrierName: z.string().nullable(),
      firstPickupEnd: z.string(),
      lastDeliveryEnd: z.string(),
      lastPositionAt: z.string().nullable(),
    }),
  ),
});

export type AlertItem = z.infer<typeof alertListSchema>["items"][number];

function conditionText(condition: string): string {
  return Object.hasOwn(ALERT_LABELS, condition)
    ? ALERT_LABELS[condition as AlertCondition]
    : condition;
}

/**
 * Transports that need attention. Each reason is a fact about the plan or the data received
 * (a window that passed, a position that is missing or old). Loadlane does not estimate arrivals.
 */
export function AlertsList({ items, timeZone }: { items: AlertItem[]; timeZone: string }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing needs attention"
        description="No planned window has passed and no transport on the road is missing a position."
      />
    );
  }
  return (
    <Card className="p-2 sm:p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Transport</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Why</TableHead>
            <TableHead>Delivery window ended</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <a href={`/transports/${item.id}`} className="font-medium hover:underline">
                  {item.reference}
                </a>
                <p className="text-xs text-muted-foreground">
                  {item.customerName}
                  {item.carrierName ? ` · ${item.carrierName}` : ""}
                </p>
              </TableCell>
              <TableCell>{statusLabel(item.status)}</TableCell>
              <TableCell>
                <ul className="space-y-0.5">
                  {item.conditions.map((condition) => (
                    <li key={condition}>{conditionText(condition)}</li>
                  ))}
                </ul>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatInZone(item.lastDeliveryEnd, timeZone)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
