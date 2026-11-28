import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { pdfSafe, renderQuotePdf, type QuotePdfData } from "./quote-pdf.ts";

const data: QuotePdfData = {
  issuer: "Acme Logistics",
  reference: "QT-000007",
  customerName: "Big Customer Inc",
  calculationName: "Dallas, TX to Houston, TX",
  priceCents: 103_500,
  validUntil: "2030-12-31",
  terms: "Net 30. ".repeat(80),
  status: "sent",
};

describe("renderQuotePdf", () => {
  it("makes a one page PDF with the quote reference as its title", async () => {
    const bytes = await renderQuotePdf(data);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const loaded = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(loaded.getPageCount()).toBe(1);
    expect(loaded.getTitle()).toBe("Quote QT-000007");
    expect(loaded.getProducer()).toBe("Loadlane");
  });

  it("handles missing terms, drafts and text outside Latin-1 without failing", async () => {
    await expect(renderQuotePdf({ ...data, terms: null, status: "draft" })).resolves.toBeInstanceOf(
      Uint8Array,
    );
    await expect(
      renderQuotePdf({
        ...data,
        customerName: "東京 Logistics ✓",
        terms: "Zahlung in 30 Tagen – größer ≥ 5",
      }),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it("cannot carry internal figures: the data type has no cost, markup or margin", () => {
    expect(Object.keys(data).sort()).toEqual([
      "calculationName",
      "customerName",
      "issuer",
      "priceCents",
      "reference",
      "status",
      "terms",
      "validUntil",
    ]);
  });
});

describe("pdfSafe", () => {
  it("keeps Latin-1 and line breaks, replaces everything else", () => {
    expect(pdfSafe("Café größer\nzweite")).toBe("Café größer\nzweite");
    expect(pdfSafe("東京 ✓")).toBe("?? ?");
    expect(pdfSafe("a\tb\u0000c")).toBe("a?b?c");
  });
});
