import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { formatUsd } from "@loadlane/shared";

/**
 * What the customer sees on a quote. Deliberately small: no cost, markup, margin or contribution
 * can reach this type, so the PDF cannot leak them.
 */
export interface QuotePdfData {
  issuer: string;
  reference: string;
  customerName: string;
  calculationName: string;
  priceCents: number;
  /** YYYY-MM-DD */
  validUntil: string;
  terms: string | null;
  /** Shown as "Draft" or "Cancelled" so a preview is never mistaken for an offer. */
  status: string;
}

/** Standard PDF fonts only cover Latin-1; other characters are replaced instead of failing. */
export function pdfSafe(text: string): string {
  let out = "";
  for (const character of text.replace(/\r\n?/g, "\n")) {
    const code = character.codePointAt(0) ?? 63;
    out += code === 10 || (code >= 32 && code <= 255 && code !== 127) ? character : "?";
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of pdfSafe(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || line === "") line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function renderQuotePdf(data: QuotePdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle(pdfSafe(`Quote ${data.reference}`));
  pdf.setProducer("Loadlane");
  pdf.setCreator("Loadlane");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]); // US Letter
  const left = 56;
  const width = 612 - 2 * left;
  const grey = rgb(0.4, 0.4, 0.4);
  let y = 730;

  page.drawText(pdfSafe(data.issuer), { x: left, y, size: 11, font: bold });
  y -= 36;
  page.drawText("QUOTE", { x: left, y, size: 24, font: bold });
  page.drawText(pdfSafe(data.reference), {
    x: 612 - left - bold.widthOfTextAtSize(pdfSafe(data.reference), 14),
    y: y + 4,
    size: 14,
    font: bold,
  });
  y -= 22;
  if (data.status === "draft" || data.status === "cancelled") {
    page.drawText(data.status === "draft" ? "DRAFT - not yet offered" : "CANCELLED", {
      x: left,
      y,
      size: 11,
      font: bold,
      color: rgb(0.75, 0.15, 0.15),
    });
    y -= 22;
  }

  y -= 12;
  const row = (label: string, value: string) => {
    page.drawText(label, { x: left, y, size: 10, font: regular, color: grey });
    page.drawText(pdfSafe(value), { x: left + 110, y, size: 11, font: regular });
    y -= 20;
  };
  row("Prepared for", data.customerName);
  row("Service", data.calculationName);
  row("Valid until", data.validUntil);

  y -= 14;
  page.drawLine({
    start: { x: left, y },
    end: { x: left + width, y },
    thickness: 0.7,
    color: grey,
  });
  y -= 36;
  page.drawText("Total price", { x: left, y, size: 12, font: regular });
  const price = formatUsd(data.priceCents);
  page.drawText(price, {
    x: left + width - bold.widthOfTextAtSize(price, 22),
    y: y - 4,
    size: 22,
    font: bold,
  });
  y -= 22;
  page.drawLine({
    start: { x: left, y },
    end: { x: left + width, y },
    thickness: 0.7,
    color: grey,
  });

  if (data.terms) {
    y -= 34;
    page.drawText("Terms", { x: left, y, size: 12, font: bold });
    y -= 20;
    for (const line of wrap(data.terms, regular, 10, width)) {
      if (y < 80) break; // one page; very long terms are cut at the bottom margin
      page.drawText(line, { x: left, y, size: 10, font: regular });
      y -= 14;
    }
  }

  page.drawText(
    "Prices in US dollars. Valid for the service described above until the date shown.",
    {
      x: left,
      y: 48,
      size: 8,
      font: regular,
      color: grey,
    },
  );
  return pdf.save();
}
