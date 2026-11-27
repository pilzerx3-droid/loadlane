import { Card, CardHeader, CardTitle, Button } from "@loadlane/ui";
import { revokeDriverLinkAction } from "../app/driver-link-actions";
import type { DriverLinkItem } from "../lib/driver-links";
import { DriverLinkCreate } from "./driver-link-create";

const STATE_LABELS = { active: "Active", expired: "Expired", revoked: "Revoked" } as const;

function consentText(link: DriverLinkItem): string {
  if (!link.consent) return "Driver has not opened the consent screen yet";
  if (link.consent.withdrawnAt) return "Driver stopped sharing their position";
  return "Driver agreed to share their position";
}

/** Driver Links of a transport: who may open it, until when, and whether the driver agreed to GPS. */
export function DriverLinksCard({
  transportId,
  links,
  canManage,
  timeZone,
}: {
  transportId: string;
  links: DriverLinkItem[];
  canManage: boolean;
  timeZone: string;
}) {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <Card className="p-5">
      <CardHeader>
        <CardTitle>Driver Link</CardTitle>
      </CardHeader>
      <p className="mb-3 text-sm text-muted-foreground">
        The driver opens the link on a phone without an account. Position sharing starts only after
        the driver agrees on a consent screen.
      </p>

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Driver Link created yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {links.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="text-sm">
                <p className="font-medium">
                  {STATE_LABELS[link.state]}
                  {link.state === "active"
                    ? ` · until ${format.format(new Date(link.expiresAt))}`
                    : ""}
                </p>
                <p className="text-muted-foreground">
                  Created {format.format(new Date(link.createdAt))} by {link.createdBy.displayName}{" "}
                  · {consentText(link)}
                </p>
              </div>
              {canManage && link.state === "active" ? (
                <form action={revokeDriverLinkAction.bind(null, transportId, link.id)}>
                  <Button type="submit" variant="ghost" size="sm">
                    Revoke
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="mt-5 border-t border-border pt-4">
          <DriverLinkCreate transportId={transportId} />
        </div>
      ) : null}
    </Card>
  );
}
