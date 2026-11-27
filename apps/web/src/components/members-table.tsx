import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type BadgeProps,
} from "@loadlane/ui";
import type { MembersResponse } from "../lib/api-client";

type Member = MembersResponse["members"][number];

const STATUS: Record<Member["status"], { label: string; variant: BadgeProps["variant"] }> = {
  active: { label: "Active", variant: "positive" },
  invited: { label: "Invited", variant: "neutral" },
  suspended: { label: "Suspended", variant: "warning" },
  removed: { label: "Removed", variant: "danger" },
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  dispatcher: "Dispatcher",
  sales: "Sales",
  carrier_user: "Carrier user",
};

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

/** Members of the organization with their roles and status. */
export function MembersTable({
  members,
  currentUserId,
}: {
  members: Member[];
  currentUserId: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>E-mail</TableHead>
          <TableHead>Roles</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => {
          const status = STATUS[member.status];
          return (
            <TableRow key={member.userId}>
              <TableCell className="font-medium">
                {member.displayName}
                {member.userId === currentUserId ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>
                ) : null}
              </TableCell>
              <TableCell className="text-muted-foreground">{member.email}</TableCell>
              <TableCell>
                {member.roles.length === 0 ? (
                  <span className="text-muted-foreground">No role</span>
                ) : (
                  <span className="flex flex-wrap gap-1.5">
                    {member.roles.map((role) => (
                      <Badge key={role}>{roleLabel(role)}</Badge>
                    ))}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={status.variant}>{status.label}</Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Previous and next links for a paged list. Pages start at 1. */
export function Pagination({
  page,
  pageSize,
  total,
  path,
  query = {},
}: {
  page: number;
  pageSize: number;
  total: number;
  path: string;
  /** Other query parameters to keep on the links, for example a search text. */
  query?: Record<string, string>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const link = (target: number) => {
    const params = new URLSearchParams(query);
    params.set("page", String(target));
    return `${path}?${params.toString()}`;
  };
  const linkClass =
    "rounded-control border border-border px-3 py-1.5 text-sm hover:border-muted-foreground";
  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">
        Page {page} of {pages}, {total} in total
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <a href={link(page - 1)} rel="prev" className={linkClass}>
            Previous
          </a>
        ) : null}
        {page < pages ? (
          <a href={link(page + 1)} rel="next" className={linkClass}>
            Next
          </a>
        ) : null}
      </span>
    </nav>
  );
}
