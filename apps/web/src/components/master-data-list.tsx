import { Plus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@loadlane/ui";
import type { MasterDataConfig } from "../lib/master-data";
import { Pagination } from "./members-table";

export interface MasterDataRecord {
  id: string;
  archivedAt?: unknown;
  [key: string]: unknown;
}

function cell(value: unknown): string {
  return typeof value === "string" && value !== "" ? value : "–";
}

/** Search box, the list and its paging for one kind of master data. */
export function MasterDataList({
  config,
  records,
  total,
  page,
  pageSize,
  q,
  includeArchived,
  canManage,
}: {
  config: MasterDataConfig;
  records: MasterDataRecord[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  includeArchived: boolean;
  canManage: boolean;
}) {
  const filtered = q !== "" || includeArchived;
  const query: Record<string, string> = {};
  if (q) query["q"] = q;
  if (includeArchived) query["archived"] = "1";
  const plural = config.plural.toLowerCase();

  return (
    <div className="space-y-4">
      <form method="get" role="search" className="flex flex-wrap items-center gap-3">
        <label htmlFor="q" className="sr-only">
          Search {plural}
        </label>
        <Input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder={`Search ${plural}`}
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" name="archived" value="1" defaultChecked={includeArchived} />
          Show archived
        </label>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {records.length === 0 ? (
        <EmptyState
          title={filtered ? `No ${plural} match` : `No ${plural} yet`}
          description={
            filtered
              ? "Try a different search or show archived records."
              : canManage
                ? `Add your first ${config.singular} to use it on transports.`
                : `Nobody has added a ${config.singular} yet.`
          }
          action={
            canManage && !filtered ? (
              <Button asChild>
                <a href={`${config.path}/new`}>
                  <Plus aria-hidden="true" /> Add {config.singular}
                </a>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="p-2 sm:p-4">
          <Table>
            <TableHeader>
              <TableRow>
                {config.columns.map((column) => (
                  <TableHead key={column.key}>{column.label}</TableHead>
                ))}
                <TableHead>
                  <span className="sr-only">Status</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.id}>
                  {config.columns.map((column, index) => (
                    <TableCell
                      key={column.key}
                      className={index === 0 ? "font-medium" : "text-muted-foreground"}
                    >
                      {index === 0 ? (
                        <a href={`${config.path}/${record.id}`} className="hover:underline">
                          {cell(record[column.key])}
                        </a>
                      ) : (
                        cell(record[column.key])
                      )}
                    </TableCell>
                  ))}
                  <TableCell>
                    {record.archivedAt ? <Badge variant="warning">Archived</Badge> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            path={config.path}
            query={query}
          />
        </Card>
      )}
    </div>
  );
}
