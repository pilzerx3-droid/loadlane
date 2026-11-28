import { z } from "zod";
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
import { formatInZone } from "@loadlane/shared";
import { Pagination } from "./members-table";

export const auditListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      occurredAt: z.string(),
      action: z.string(),
      entityType: z.string().nullable(),
      entityId: z.string().nullable(),
      actor: z.object({ id: z.string(), displayName: z.string() }).nullable(),
      changes: z.unknown(),
    }),
  ),
  page: z.object({ total: z.number().int() }),
});

export type AuditItem = z.infer<typeof auditListSchema>["items"][number];

const KIND_LABELS: Record<string, string> = {
  transport: "Transport",
  document: "Document",
  customer: "Customer",
  carrier: "Carrier",
  location: "Location",
  organization: "Organization",
  driver_link: "Driver Link",
  tracking_link: "Tracking link",
};

const VERB_LABELS: Record<string, string> = {
  created: "created",
  updated: "changed",
  archived: "archived",
  restored: "restored",
  revoked: "revoked",
  deleted: "removed",
  uploaded: "uploaded",
  downloaded: "downloaded",
  imported: "imported",
  status_changed: "changed the status of",
};

/** "transport.status_changed" becomes "changed the status of a transport". */
export function describeAction(action: string): string {
  const [kind = "", ...rest] = action.split(".");
  const verb = VERB_LABELS[rest.join(".")];
  const noun = (KIND_LABELS[kind] ?? kind).toLowerCase();
  if (!verb) return action;
  return verb === "imported" ? `imported ${noun}s` : `${verb} a ${noun}`;
}

function entityLink(item: AuditItem): string | undefined {
  if (item.entityType === "transport" && item.entityId) return `/transports/${item.entityId}`;
  if (item.entityType === "customer" && item.entityId) return `/customers/${item.entityId}`;
  if (item.entityType === "carrier" && item.entityId) return `/carriers/${item.entityId}`;
  if (item.entityType === "location" && item.entityId) return `/locations/${item.entityId}`;
  return undefined;
}

const FILTERS = ["transport", "document", "customer", "carrier", "location"] as const;

/** The audit trail: who did what, when. */
export function ActivityList({
  items,
  total,
  page,
  pageSize,
  entityType,
  timeZone,
}: {
  items: AuditItem[];
  total: number;
  page: number;
  pageSize: number;
  entityType: string;
  timeZone: string;
}) {
  return (
    <div className="space-y-4">
      <nav aria-label="Filter" className="flex flex-wrap gap-2 text-sm">
        {["", ...FILTERS].map((kind) => (
          <a
            key={kind}
            href={kind === "" ? "/activity" : `/activity?type=${kind}`}
            aria-current={entityType === kind ? "page" : undefined}
            className={`rounded-control border px-3 py-1.5 ${
              entityType === kind ? "border-foreground" : "border-border text-muted-foreground"
            }`}
          >
            {kind === "" ? "Everything" : `${KIND_LABELS[kind]}s`}
          </a>
        ))}
      </nav>
      {items.length === 0 ? (
        <EmptyState title="Nothing recorded yet" description="Changes to your data show up here." />
      ) : (
        <Card className="p-2 sm:p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const link = entityLink(item);
                const text = describeAction(item.action);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="text-muted-foreground">
                      {formatInZone(item.occurredAt, timeZone)}
                    </TableCell>
                    <TableCell>{item.actor?.displayName ?? "System"}</TableCell>
                    <TableCell>
                      {link ? (
                        <a href={link} className="hover:underline">
                          {text}
                        </a>
                      ) : (
                        text
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            path="/activity"
            query={entityType ? { type: entityType } : {}}
          />
        </Card>
      )}
    </div>
  );
}
