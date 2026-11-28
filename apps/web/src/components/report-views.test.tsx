import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { periodStart, type CommercialReport } from "../lib/reports";
import { CommercialReportView } from "./report-views";

const report: CommercialReport = {
  period: { from: "2030-01-01", to: "2030-01-30" },
  note: "Nothing is estimated.",
  spot: {
    offers: 4,
    awarded: 2,
    cancelled: 1,
    stillOpen: 1,
    awardRateBp: 6_667,
    bidsPerOffer: 2.5,
    averageAwardedPriceCents: 85_000,
    offersWithTarget: 2,
    belowTargetCents: 12_000,
  },
  quotes: {
    created: 5,
    sent: 4,
    accepted: 2,
    rejected: 1,
    acceptanceRateBp: 6_667,
    acceptedValueCents: 207_000,
    acceptedContributionCents: 27_000,
    acceptedMarginBp: 1_304,
  },
  deliveries: { delivered: 10, withDeliveryWindow: 10, onTime: 9, onTimeRateBp: 9_000 },
};

describe("CommercialReportView", () => {
  it("shows the figures with money and percentages formatted", () => {
    const html = renderToStaticMarkup(<CommercialReportView report={report} selected="30" />);
    expect(html).toContain("$850.00");
    expect(html).toContain("$120.00 below");
    expect(html).toContain("66.67 %");
    expect(html).toContain("13.04 %");
    expect(html).toContain("90.00 %");
    expect(html).toContain("2.50");
    expect(html).toContain("Nothing is estimated.");
    expect(html).toContain("2030-01-01 to 2030-01-30");
  });

  it("marks the chosen period and offers the others", () => {
    const html = renderToStaticMarkup(<CommercialReportView report={report} selected="90" />);
    expect(html).toContain('href="/reports?period=30"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html.indexOf("aria-current")).toBeGreaterThan(html.indexOf("Last 30 days"));
  });

  it("shows n/a instead of invented numbers when there is nothing to divide by", () => {
    const empty: CommercialReport = {
      ...report,
      spot: {
        ...report.spot,
        offers: 0,
        awardRateBp: null,
        bidsPerOffer: null,
        averageAwardedPriceCents: null,
        offersWithTarget: 0,
        belowTargetCents: 0,
      },
      quotes: { ...report.quotes, acceptanceRateBp: null, acceptedMarginBp: null },
      deliveries: { ...report.deliveries, onTimeRateBp: null },
    };
    const html = renderToStaticMarkup(<CommercialReportView report={empty} selected="30" />);
    expect(html.match(/n\/a/g)!.length).toBeGreaterThanOrEqual(6);
  });

  it("says above target when awarded prices exceeded the targets", () => {
    const html = renderToStaticMarkup(
      <CommercialReportView
        report={{ ...report, spot: { ...report.spot, belowTargetCents: -5_000 } }}
        selected="30"
      />,
    );
    expect(html).toContain("+$50.00 above");
  });
});

describe("periodStart", () => {
  it("counts inclusive days back from today", () => {
    expect(periodStart("2030-01-30", 30)).toBe("2030-01-01");
    expect(periodStart("2030-03-01", 90)).toBe("2029-12-02");
    expect(periodStart("2030-01-01", 1)).toBe("2030-01-01");
  });
});
