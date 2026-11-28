import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TariffDetail, TariffSummary } from "../lib/tariffs";

vi.mock("../app/tariff-actions", () => ({ archiveTariffAction: () => undefined }));

const { TariffDetailView, TariffsList } = await import("./tariff-views");

const summary: TariffSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme 2030",
  kind: "sell",
  party: { id: "c", name: "Acme" },
  archived: false,
  versions: 2,
  latestValidFrom: "2030-07-01",
  createdAt: "2030-01-01T00:00:00.000Z",
};

const version = (n: number, from: string, rate: number) => ({
  id: `v${n}`,
  version: n,
  validFrom: from,
  note: n === 2 ? "Summer" : null,
  lines: [
    { kind: "mileage", label: "Line haul", unit: "mile", rateCents: rate, minimumCents: null },
    { kind: "loading", label: "Pallets", unit: "pallet", rateCents: 1_250, minimumCents: 5_000 },
  ],
  createdAt: "2030-01-01T00:00:00.000Z",
  createdBy: { id: "u", displayName: "Dana" },
});

const detail: TariffDetail = {
  ...summary,
  currentVersion: version(2, "2030-07-01", 245),
  allVersions: [version(2, "2030-07-01", 245), version(1, "2030-01-01", 235)],
};

describe("TariffsList", () => {
  it("shows an empty state and one row per list", () => {
    expect(renderToStaticMarkup(<TariffsList items={[]} canManage />)).toContain(
      "No price lists yet",
    );
    const html = renderToStaticMarkup(<TariffsList items={[summary]} canManage />);
    expect(html).toContain("Acme 2030");
    expect(html).toContain("Sell (customer)");
    expect(html).toContain("2030-07-01");
  });
});

describe("TariffDetailView", () => {
  it("shows every version with its rates, marks the one in force and says versions are frozen", () => {
    const html = renderToStaticMarkup(<TariffDetailView tariff={detail} canManage />);
    expect(html).toContain("Version 2 · from 2030-07-01 (in force today)");
    expect(html).toContain("Version 1 · from 2030-01-01");
    expect(html).toContain("$2.45");
    expect(html).toContain("$2.35");
    expect(html).toContain("per mile");
    expect(html).toContain("$50.00");
    expect(html).toContain("This version is frozen");
    expect(html).toContain("Add a new version");
  });

  it("offers no changes to read-only people and no new version for an archived list", () => {
    expect(
      renderToStaticMarkup(<TariffDetailView tariff={detail} canManage={false} />),
    ).not.toContain("Add a new version");
    const archived = renderToStaticMarkup(
      <TariffDetailView tariff={{ ...detail, archived: true }} canManage />,
    );
    expect(archived).not.toContain("Add a new version");
    expect(archived).toContain("Restore");
  });
});
