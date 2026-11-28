import {
  COST_KIND_LABELS,
  TARIFF_UNIT_LABELS,
  formatUsd,
  isCostKind,
  isTariffUnit,
} from "@loadlane/shared";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@loadlane/ui";
import { archiveTariffAction } from "../app/tariff-actions";
import type { TariffDetail, TariffSummary, TariffVersion } from "../lib/tariffs";

export function TariffsList({ items, canManage }: { items: TariffSummary[]; canManage: boolean }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No price lists yet"
        description="A price list holds rates per mile, pallet, pound or hour, in dated versions that never change."
        action={
          canManage ? (
            <a href="/tariffs/new" className="text-sm underline">
              New price list
            </a>
          ) : undefined
        }
      />
    );
  }
  return (
    <Card className="p-2 sm:p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Belongs to</TableHead>
            <TableHead className="text-right">Versions</TableHead>
            <TableHead>Latest from</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <a href={`/tariffs/${item.id}`} className="font-medium hover:underline">
                  {item.name}
                </a>
              </TableCell>
              <TableCell>{item.kind === "sell" ? "Sell (customer)" : "Buy (carrier)"}</TableCell>
              <TableCell>{item.party?.name ?? "Anyone"}</TableCell>
              <TableCell className="text-right font-mono">{item.versions}</TableCell>
              <TableCell className="text-muted-foreground">{item.latestValidFrom ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function VersionTable({ version }: { version: TariffVersion }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Unit</TableHead>
          <TableHead className="text-right">Rate</TableHead>
          <TableHead className="text-right">Minimum</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {version.lines.map((line, index) => (
          <TableRow key={index}>
            <TableCell>{isCostKind(line.kind) ? COST_KIND_LABELS[line.kind] : line.kind}</TableCell>
            <TableCell>{line.label}</TableCell>
            <TableCell>
              {isTariffUnit(line.unit) ? TARIFF_UNIT_LABELS[line.unit] : line.unit}
            </TableCell>
            <TableCell className="text-right font-mono">{formatUsd(line.rateCents)}</TableCell>
            <TableCell className="text-right font-mono">
              {line.minimumCents === null ? "—" : formatUsd(line.minimumCents)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** A price list with every version, newest first. Versions are frozen; changing rates adds a version. */
export function TariffDetailView({
  tariff,
  canManage,
}: {
  tariff: TariffDetail;
  canManage: boolean;
}) {
  const currentId = tariff.currentVersion?.id;
  return (
    <div className="space-y-5">
      <Card className="space-y-1 p-5 text-sm">
        <p>
          {tariff.kind === "sell" ? "Sell price list" : "Buy price list"} ·{" "}
          {tariff.party ? `for ${tariff.party.name}` : "for anyone"}
          {tariff.archived ? " · archived" : ""}
        </p>
        <p className="text-muted-foreground">
          {tariff.currentVersion
            ? `Version ${tariff.currentVersion.version} (from ${tariff.currentVersion.validFrom}) is in force today.`
            : "No version is in force today."}
        </p>
        {canManage ? (
          <div className="flex flex-wrap gap-2 pt-2">
            {!tariff.archived ? (
              <Button asChild variant="outline" size="sm">
                <a href={`/tariffs/${tariff.id}/version`}>Add a new version</a>
              </Button>
            ) : null}
            <form action={archiveTariffAction.bind(null, tariff.id, !tariff.archived)}>
              <Button type="submit" variant="ghost" size="sm">
                {tariff.archived ? "Restore" : "Archive"}
              </Button>
            </form>
          </div>
        ) : null}
      </Card>
      {tariff.allVersions.map((version) => (
        <Card key={version.id} className="p-5">
          <CardHeader>
            <CardTitle>
              Version {version.version} · from {version.validFrom}
              {version.id === currentId ? " (in force today)" : ""}
            </CardTitle>
          </CardHeader>
          {version.note ? (
            <p className="mb-2 text-sm text-muted-foreground">{version.note}</p>
          ) : null}
          <VersionTable version={version} />
          <p className="mt-2 text-xs text-muted-foreground">
            Saved {version.createdAt.slice(0, 10)} by {version.createdBy.displayName}. This version
            is frozen.
          </p>
        </Card>
      ))}
    </div>
  );
}
