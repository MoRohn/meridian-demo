import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ReportDoc } from "../doc";

import { glyphCoverage, makePdfText, toBase64, type PdfFonts } from "./pdfFonts";

type RGB = [number, number, number];
const INK: RGB = [28, 37, 48];
const MUTED: RGB = [93, 107, 122];
const DEEP: RGB = [15, 61, 62];
const WASH: RGB = [244, 246, 248];
const WARN: RGB = [138, 90, 0];

const MARGIN = 12;
const HEADING_SIZE = { 1: 20, 2: 15, 3: 12, 4: 10 } as const;

/** A PDF (landscape A4) with the DejaVu fonts embedded. jsPDF and its table plugin are loaded only when this format is chosen. */
export async function renderPdf(report: ReportDoc, fonts: PdfFonts): Promise<Blob> {
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  for (const [key, family, style] of [["regular", "DejaVu", "normal"], ["bold", "DejaVu", "bold"], ["italic", "DejaVu", "italic"], ["mono", "DejaVuMono", "normal"]] as const) {
    const file = `${family}-${style}.ttf`;
    pdf.addFileToVFS(file, toBase64(fonts[key]));
    pdf.addFont(file, family, style, undefined, "Identity-H");
  }
  const sanitizer = makePdfText(glyphCoverage(fonts.regular));
  const pdfSafe = sanitizer.clean;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const width = pageW - 2 * MARGIN;
  const bottom = pageH - MARGIN - 4; // room for the page number
  let y = MARGIN;

  const lineHeight = (size: number) => size * 0.3528 * 1.4; // pt to mm, with leading
  const ensure = (h: number) => {
    if (y + h > bottom) {
      pdf.addPage();
      y = MARGIN;
    }
  };
  const font = (style: "normal" | "bold" | "italic", size: number, color: RGB, family = "DejaVu") => {
    pdf.setFont(family, style);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
  };
  const wrap = (text: string, w: number) => pdf.splitTextToSize(pdfSafe(text), w) as string[];
  /** Draws wrapped lines, breaking across pages line by line so a long block never runs off the page. */
  const lines = (rows: string[], x: number, size: number, before?: (lineY: number) => void) => {
    const lh = lineHeight(size);
    for (const row of rows) {
      ensure(lh);
      before?.(y);
      pdf.text(row, x, y + lh * 0.75);
      y += lh;
    }
  };

  for (const b of report.blocks) {
    switch (b.type) {
      case "heading": {
        const size = HEADING_SIZE[b.level];
        y += b.level === 1 ? 0 : b.level === 2 ? 6 : 3;
        ensure(lineHeight(size) + (b.level === 1 ? 12 : 30)); // keep a heading with what follows it, not stranded at the foot of a page
        font("bold", size, b.level === 4 ? MUTED : DEEP);
        lines(wrap(b.level === 4 ? b.text.toUpperCase() : b.text, width), MARGIN, size);
        if (b.level === 2) {
          pdf.setDrawColor(217, 223, 230);
          pdf.setLineWidth(0.4);
          pdf.line(MARGIN, y, MARGIN + width, y);
          y += 1.5;
        }
        y += 1;
        break;
      }
      case "paragraph": {
        const size = 9.5;
        const color = b.tone === "warn" ? WARN : b.tone === "muted" ? MUTED : INK;
        const lead = b.lead ? pdfSafe(b.lead) : "";
        const text = pdfSafe(b.text);
        font("bold", size, color);
        const leadW = lead ? pdf.getTextWidth(`${lead} `) : 0;
        font("normal", size, color);
        // Lead and text share a line when they fit; otherwise the bold lead stands alone and the text wraps beneath it.
        const inline = !lead || !text || leadW + pdf.getTextWidth(text) <= width;
        const lh = lineHeight(size);
        const rowCount = inline ? 1 : (lead ? 1 : 0) + wrap(text, width).length;
        ensure(lh + 1);
        if (b.tone === "warn") {
          pdf.setFillColor(253, 246, 231);
          pdf.rect(MARGIN - 1, y - 0.5, width + 2, Math.min(rowCount * lh, bottom - y) + 1, "F");
        }
        if (lead) {
          font("bold", size, color);
          lines(wrap(lead, width), MARGIN, size);
          if (inline && text) {
            y -= lh; // same line as the lead
            font("normal", size, color);
            pdf.text(text, MARGIN + leadW, y + lh * 0.75);
            y += lh;
          }
        }
        if (text && !(lead && inline)) {
          font("normal", size, color);
          lines(wrap(text, width), MARGIN, size);
        }
        y += 1;
        break;
      }
      case "list": {
        font("normal", 9.5, INK);
        b.items.forEach((item, i) => {
          const mark = b.ordered ? `${i + 1}.` : "\u2022";
          const rows = wrap(item, width - 8);
          ensure(lineHeight(9.5));
          font("normal", 9.5, INK);
          pdf.text(mark, MARGIN + 2, y + lineHeight(9.5) * 0.75);
          lines(rows, MARGIN + 8, 9.5);
        });
        y += 1;
        break;
      }
      case "quote": {
        font("italic", 9.5, INK);
        const rows = b.text.split(/\n+/).flatMap((line) => wrap(line, width - 8));
        const lh = lineHeight(9.5);
        lines(rows, MARGIN + 6, 9.5, (lineY) => {
          pdf.setFillColor(...WASH);
          pdf.rect(MARGIN, lineY, width, lh, "F");
          pdf.setFillColor(...DEEP);
          pdf.rect(MARGIN, lineY, 1, lh, "F");
          font("italic", 9.5, INK);
        });
        y += 2;
        break;
      }
      case "code": {
        font("normal", 8, INK, "DejaVuMono");
        const rows = b.text.split("\n").flatMap((line) => wrap(line || " ", width - 6));
        const lh = lineHeight(8);
        lines(rows, MARGIN + 3, 8, (lineY) => {
          pdf.setFillColor(...WASH);
          pdf.rect(MARGIN, lineY, width, lh, "F");
          font("normal", 8, INK, "DejaVuMono");
        });
        y += 2;
        break;
      }
      case "table": {
        autoTable(pdf, {
          startY: y,
          head: [b.columns.map(pdfSafe)],
          body: b.rows.map((r) => r.map(pdfSafe)),
          margin: { left: MARGIN, right: MARGIN, bottom: MARGIN + 4 },
          styles: { font: "DejaVu", fontSize: 7, cellPadding: 1.4, textColor: INK, lineColor: [217, 223, 230], lineWidth: 0.15, overflow: "linebreak" },
          headStyles: { fillColor: DEEP, textColor: [255, 255, 255], fontStyle: "bold" },
          alternateRowStyles: { fillColor: WASH },
          didParseCell: (data) => {
            if (data.section !== "body") return;
            const v = String(data.cell.raw);
            if (v === "Pass") data.cell.styles.textColor = [20, 108, 67];
            else if (v === "Fail" || v.startsWith("Failed")) data.cell.styles.textColor = [161, 42, 42];
            else return;
            data.cell.styles.fontStyle = "bold";
          },
        });
        y = ((pdf as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y) + 4;
        break;
      }
    }
  }

  const dropped = sanitizer.replaced();
  if (dropped.length) {
    y += 4;
    ensure(lineHeight(8.5) * 3);
    font("italic", 8.5, MUTED);
    // Named by code point: the characters themselves are exactly what this PDF cannot draw.
    const shown = dropped.slice(0, 20).map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(" ");
    lines(wrap(`Note: ${dropped.length} character${dropped.length === 1 ? "" : "s"} in this report (${shown}${dropped.length > 20 ? " ..." : ""}) have no glyph in the PDF's font and are shown as a placeholder. The web page and Word versions of this report keep them.`, width), MARGIN, 8.5);
  }

  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    font("normal", 8, MUTED);
    pdf.text(pdfSafe(report.title), MARGIN, pageH - 6);
    pdf.text(`Page ${p} of ${pages}`, pageW - MARGIN, pageH - 6, { align: "right" });
  }
  pdf.setProperties({ title: report.title, creator: "Meridian" });
  return pdf.output("blob");
}
