import { TRANSPORT_STATUS_LABELS, type TransportStatus } from "@loadlane/shared";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  NativeSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type BadgeProps,
} from "@loadlane/ui";
import { changeStatusAction } from "../app/transport-actions";
import type { TransportDetail, TransportListItem } from "../lib/transport-api";
import { formatInZone, formatWindow } from "@loadlane/shared";
import { Pagination } from "./members-table";

const STATUS_VARIANT: Record<TransportStatus, BadgeProps["variant"]> = {
  created: "neutral",
  planned: "neutral",
  assigned: "neutral",
  confirmed: "neutral",
  loading: "positive",
  in_transit: "positive",
  at_destination: "positive",
  unloading: "positive",
  delivered: "positive",
  completed: "neutral",
  cancelled: "danger",
};

export function statusLabel(status: string): string {
  return TRANSPORT_STATUS_LABELS[status as TransportStatus] ?? status;
}

/** The status in words. Color only supports it. */
export function TransportStatusBadge({ status }: { status: TransportStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{statusLabel(status)}</Badge>;
}

const FILTERABLE: readonly TransportStatus[] = [
  "created",
  "planned",
  "assigned",
  "confirmed",
  "in_transit",
  "delivered",
  "completed",
  "cancelled",
];

/** Search, status filter, table and paging of the transport list. */
export function TransportsList({
  items,
  total,
  page,
  pageSize,
  q,
  status,
  canManage,
}: {
  items: TransportListItem[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  status: string;
  canManage: boolean;
}) {
  const filtered = q !== "" || status !== "";
  const query: Record<string, string> = {};
  if (q) query["q"] = q;
  if (status) query["status"] = status;

  return (
    <div className="space-y-4">
      <form method="get" role="search" className="flex flex-wrap items-center gap-3">
        <label htmlFor="q" className="sr-only">
          Search transports
        </label>
        <Input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Number, reference, customer or carrier"
          className="max-w-sm"
        />
        <label htmlFor="status" className="sr-only">
          Status
        </label>
        <NativeSelect id="status" name="status" defaultValue={status} className="w-auto">
          <option value="">All statuses</option>
          {FILTERABLE.map((value) => (
            <option key={value} value={value}>
              {statusLabel(value)}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          title={filtered ? "No transports match" : "No transports yet"}
          description={
            filtered
              ? "Try a different search or status."
              : canManage
                ? "Create your first transport, or add customers, carriers and locations first."
                : "Nobody has created a transport yet."
          }
          action={
            canManage && !filtered ? (
              <Button asChild>
                <a href="/transports/new">New transport</a>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="p-2 sm:p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transport</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Pickup</TableHead>
                <TableHead>Carrier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    <a href={`/transports/${item.id}`} className="font-mono hover:underline">
                      {item.reference}
                    </a>
                    {item.customerReference ? (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {item.customerReference}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <TransportStatusBadge status={item.status} />
                  </TableCell>
                  <TableCell>{item.customer.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.origin.city}, {item.origin.state} → {item.destination.city},{" "}
                    {item.destination.state}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatInZone(item.origin.windowStart, item.origin.timezone)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.carrier?.name ?? "Not assigned"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            path="/transports"
            query={query}
          />
        </Card>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

/** One transport: facts, stops, status actions and the history. */
export function TransportDetailView({
  transport,
  canManage,
}: {
  transport: TransportDetail;
  canManage: boolean;
}) {
  const changeStatus = changeStatusAction.bind(null, transport.id);
  const next = transport.allowedStatuses;
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Fact label="Customer">{transport.customer.name}</Fact>
          <Fact label="Carrier">{transport.carrier?.name ?? "Not assigned"}</Fact>
          <Fact label="Customer reference">{transport.customerReference ?? "–"}</Fact>
          <Fact label="Purchase order">{transport.purchaseOrder ?? "–"}</Fact>
          <Fact label="Weight">
            {transport.weightLb === null ? "–" : `${transport.weightLb.toLocaleString("en-US")} lb`}
          </Fact>
          <Fact label="Pieces">{transport.pieces ?? "–"}</Fact>
          <Fact label="Created">
            {formatInZone(transport.createdAt, transport.stops[0]?.location.timezone ?? "UTC")}
          </Fact>
        </dl>
        {transport.notes ? (
          <p className="mt-4 text-sm whitespace-pre-line text-muted-foreground">
            {transport.notes}
          </p>
        ) : null}
      </Card>

      <Card className="p-5">
        <CardHeader>
          <CardTitle>Stops</CardTitle>
        </CardHeader>
        <ol className="space-y-4">
          {transport.stops.map((stop) => (
            <li key={stop.id} className="flex gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs">
                {stop.sequence}
              </span>
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  {stop.type === "pickup" ? "Pickup" : "Delivery"} · {stop.location.name}
                </p>
                <p className="text-muted-foreground">
                  {stop.location.addressLine1}
                  {stop.location.addressLine2 ? `, ${stop.location.addressLine2}` : ""},{" "}
                  {stop.location.city}, {stop.location.state} {stop.location.postalCode}
                </p>
                <p>{formatWindow(stop.windowStart, stop.windowEnd, stop.location.timezone)}</p>
                {stop.reference ? (
                  <p className="text-muted-foreground">Reference {stop.reference}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-muted-foreground">
          Times are shown in the time zone of each location.
        </p>
      </Card>

      {canManage && next.length > 0 ? (
        <Card className="p-5">
          <CardHeader>
            <CardTitle>Change status</CardTitle>
          </CardHeader>
          <form action={changeStatus} className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="status" className="mb-1 block text-[13px] font-semibold">
                New status
              </label>
              <NativeSelect id="status" name="status" className="w-auto" defaultValue={next[0]}>
                {next.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="min-w-48 flex-1">
              <label htmlFor="note" className="mb-1 block text-[13px] font-semibold">
                Note <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input id="note" name="note" maxLength={500} autoComplete="off" />
            </div>
            <Button type="submit">Change status</Button>
          </form>
        </Card>
      ) : null}

      <Card className="p-5">
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <ol className="space-y-3">
          {transport.events.map((event) => (
            <li key={event.id} className="text-sm">
              <p>
                <span className="font-medium">
                  {event.fromStatus
                    ? `${statusLabel(event.fromStatus)} → ${statusLabel(event.toStatus)}`
                    : statusLabel(event.toStatus)}
                </span>{" "}
                <span className="text-muted-foreground">
                  · {formatInZone(event.occurredAt, transport.stops[0]?.location.timezone ?? "UTC")}
                  {event.actor ? ` · ${event.actor.displayName}` : ""}
                </span>
              </p>
              {event.note ? <p className="text-muted-foreground">{event.note}</p> : null}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
