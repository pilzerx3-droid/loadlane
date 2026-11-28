import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TenderDetail, TenderSummary } from "../lib/spot";

vi.mock("../app/spot-actions", () => ({
  awardBidAction: () => undefined,
  cancelTenderAction: () => undefined,
  enterBidAction: () => undefined,
  createTenderAction: () => Promise.resolve({}),
}));

const { TenderDetailView, TendersList } = await import("./spot-views");

const summary: TenderSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "open",
  transport: {
    id: "22222222-2222-4222-8222-222222222222",
    reference: "LL-000009",
    status: "created",
  },
  origin: "Dallas, TX",
  destination: "Houston, TX",
  responseDeadline: "2030-12-01T20:00:00.000Z",
  deadlinePassed: false,
  invited: 3,
  liveBids: 2,
  lowestLiveBidCents: 82_000,
  createdAt: "2030-11-30T10:00:00.000Z",
};

const detail: TenderDetail = {
  ...summary,
  targetPriceCents: 90_000,
  notes: null,
  awardedAt: null,
  awardedBy: null,
  stops: [
    {
      sequence: 1,
      type: "pickup",
      placeName: "Dock A",
      city: "Dallas",
      state: "TX",
      windowStart: "2030-12-02T14:00:00.000Z",
      windowEnd: "2030-12-02T16:00:00.000Z",
      timezone: "America/Chicago",
    },
  ],
  invitations: [
    {
      id: "i1",
      carrier: { id: "c1", name: "Blue Line" },
      state: "active",
      expiresAt: "2030-12-05T00:00:00.000Z",
    },
  ],
  bids: [
    {
      id: "b1",
      carrier: { id: "c1", name: "Blue Line" },
      priceCents: 82_000,
      note: "Mon",
      status: "submitted",
      source: "carrier_link",
      createdAt: "2030-12-01T10:00:00.000Z",
    },
    {
      id: "b2",
      carrier: { id: "c2", name: "Red Haul" },
      priceCents: 95_000,
      note: null,
      status: "submitted",
      source: "staff",
      createdAt: "2030-12-01T11:00:00.000Z",
    },
  ],
};

describe("TendersList", () => {
  it("shows an empty state and a row per offer", () => {
    expect(renderToStaticMarkup(<TendersList items={[]} timeZone="UTC" />)).toContain(
      "No spot freight offers yet",
    );
    const html = renderToStaticMarkup(<TendersList items={[summary]} timeZone="UTC" />);
    expect(html).toContain("LL-000009");
    expect(html).toContain("Dallas, TX → Houston, TX");
    expect(html).toContain("2 / 3");
    expect(html).toContain("$820.00");
  });
});

describe("TenderDetailView", () => {
  it("compares bids against the target and offers an award button for each valid bid", () => {
    const html = renderToStaticMarkup(
      <TenderDetailView tender={detail} canManage timeZone="UTC" />,
    );
    expect(html).toContain("-$80.00"); // 820 vs target 900
    expect(html).toContain("+$50.00"); // 950 vs target 900
    expect(html.match(/>Award</g)).toHaveLength(2);
    expect(html).toContain("(entered by you)");
    expect(html).toContain("never picks a bid for you");
    expect(html).toContain("carriers do not see it");
  });

  it("offers nothing to change to read-only people or on a finished offer", () => {
    const readOnly = renderToStaticMarkup(
      <TenderDetailView tender={detail} canManage={false} timeZone="UTC" />,
    );
    expect(readOnly).not.toContain(">Award<");
    expect(readOnly).not.toContain("Cancel this offer");
    const done = renderToStaticMarkup(
      <TenderDetailView
        tender={{
          ...detail,
          status: "awarded",
          awardedAt: "2030-12-01T12:00:00.000Z",
          awardedBy: { id: "u", displayName: "Dana" },
          bids: detail.bids.map((bid) => ({
            ...bid,
            status: bid.id === "b1" ? ("awarded" as const) : ("rejected" as const),
          })),
        }}
        canManage
        timeZone="UTC"
      />,
    );
    expect(done).not.toContain(">Award<");
    expect(done).toContain("by Dana");
    expect(done).toContain("Not selected");
  });
});
