import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { QuoteDetail, QuoteSummary } from "../lib/quotes";

vi.mock("../app/quote-actions", () => ({
  createQuoteAction: () => undefined,
  updateQuoteAction: () => undefined,
  changeQuoteStatusAction: () => undefined,
}));

const { NewQuoteForm, QuoteDetailView, QuotesList } = await import("./quote-views");

const summary: QuoteSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  number: 7,
  reference: "QT-000007",
  status: "sent",
  expired: false,
  customer: { id: "c", name: "Acme" },
  calculationName: "Dallas to Houston",
  priceCents: 103_500,
  validUntil: "2030-12-31",
  createdAt: "2030-12-01T10:00:00.000Z",
};

const detail: QuoteDetail = {
  ...summary,
  transport: null,
  status: "draft",
  allowedStatuses: ["sent", "cancelled"],
  editable: true,
  terms: "Net 30",
  notes: "internal only",
  sentAt: null,
  decidedAt: null,
  createdBy: { id: "u", displayName: "Dana" },
  calculation: {
    id: "22222222-2222-4222-8222-222222222222",
    costCents: 90_000,
    contributionCents: 13_500,
    markupBp: 1_500,
    marginBp: 1_304,
  },
};

describe("QuotesList", () => {
  it("shows an empty state and a list with price and status", () => {
    expect(renderToStaticMarkup(<QuotesList items={[]} canManage />)).toContain("No quotes yet");
    const html = renderToStaticMarkup(<QuotesList items={[summary]} canManage />);
    expect(html).toContain("QT-000007");
    expect(html).toContain("$1,035.00");
    expect(html).toContain("Sent");
  });

  it("shows a sent quote past its date as expired", () => {
    const html = renderToStaticMarkup(
      <QuotesList items={[{ ...summary, expired: true }]} canManage />,
    );
    expect(html).toContain("Expired");
  });
});

describe("QuoteDetailView", () => {
  it("offers the next steps and the draft editor to people who may manage", () => {
    const html = renderToStaticMarkup(<QuoteDetailView quote={detail} canManage timeZone="UTC" />);
    expect(html).toContain("Mark as sent");
    expect(html).toContain("Cancel quote");
    expect(html).toContain("Edit draft");
    expect(html).toContain("Net 30");
    expect(html).toContain("15.00 %");
    expect(html).toContain("Loadlane does not send quotes yet");
    expect(html).toContain(`/quotes/${detail.id}/pdf`);
  });

  it("offers nothing to change for read-only people or finished quotes", () => {
    const readOnly = renderToStaticMarkup(
      <QuoteDetailView quote={detail} canManage={false} timeZone="UTC" />,
    );
    expect(readOnly).not.toContain("Mark as sent");
    expect(readOnly).not.toContain("Edit draft");
    const done = renderToStaticMarkup(
      <QuoteDetailView
        quote={{ ...detail, status: "accepted", allowedStatuses: [], editable: false }}
        canManage
        timeZone="UTC"
      />,
    );
    expect(done).not.toContain("Next step");
    expect(done).not.toContain("Edit draft");
    expect(done).toContain("Accepted");
  });
});

describe("QuoteDetailView after acceptance", () => {
  const accepted = { ...detail, status: "accepted", allowedStatuses: [], editable: false };

  it("offers to create the transport only to people who may, and links it once it exists", () => {
    const withButton = renderToStaticMarkup(
      <QuoteDetailView quote={accepted} canManage canCreateTransport timeZone="UTC" />,
    );
    expect(withButton).toContain(`/transports/new?quote=${detail.id}`);
    const without = renderToStaticMarkup(
      <QuoteDetailView quote={accepted} canManage canCreateTransport={false} timeZone="UTC" />,
    );
    expect(without).not.toContain("/transports/new?quote=");
    const linked = renderToStaticMarkup(
      <QuoteDetailView
        quote={{ ...accepted, transport: { id: "t1", reference: "LL-000012" } }}
        canManage
        canCreateTransport
        timeZone="UTC"
      />,
    );
    expect(linked).toContain("LL-000012");
    expect(linked).toContain("was created from this quote");
    expect(linked).not.toContain("/transports/new?quote=");
  });

  it("says nothing about transports while the quote is not accepted", () => {
    expect(
      renderToStaticMarkup(
        <QuoteDetailView quote={detail} canManage canCreateTransport timeZone="UTC" />,
      ),
    ).not.toContain("Create transport from this quote");
  });
});

describe("NewQuoteForm", () => {
  const props = {
    calculationId: "22222222-2222-4222-8222-222222222222",
    calculationName: "Dallas to Houston",
    priceCents: 103_500,
    customers: [{ id: "c1", label: "Acme" }],
    defaultValidUntil: "2030-12-15",
  };

  it("asks for a customer only when the calculation has none", () => {
    expect(renderToStaticMarkup(<NewQuoteForm {...props} customerFixed={false} />)).toContain(
      "Choose a customer",
    );
    expect(renderToStaticMarkup(<NewQuoteForm {...props} customerFixed />)).not.toContain(
      "Choose a customer",
    );
  });

  it("says the price is copied from the calculation", () => {
    const html = renderToStaticMarkup(<NewQuoteForm {...props} customerFixed />);
    expect(html).toContain("$1,035.00");
    expect(html).toContain("will not change");
  });
});
