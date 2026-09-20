import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ReportDoc } from "../doc";

/**
 * The PDF's built-in fonts cover Latin-1 only. Typographic punctuation is mapped to plain equivalents and anything else
 * outside that range becomes "?", so a contract's stray symbol can never garble a whole line.
 */
const REPLACEMENTS: Record<string, string> = {
  "\u2026": "...",
  "\u201c": '"',
  "\u201d": '"',
  "\u2018": "'",
  "\u2019": "'",
  "\u2013": "-",
  "\u2014": "-",
  "\u2265": ">=",
  "\u2264": "<=",
  "\u2192": "->",
  "\u2022": "-",
};
export function pdfSafe(text: string): string {
  return text
    .replace(/[\u2026\u201c\u201d\u2018\u2019\u2013\u2014\u2265\u2264\u2192\u2022]/g, (c) => REPLACEMENTS[c])
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, " ")
    .replace(/[^\n\u0020-\u007e\u00a0-\u00ff]/g, "?");
}

type RGB = [number, number, number];
const INK: RGB = [28, 37, 48];
const MUTED: RGB = [93, 107, 122];
const DEEP: RGB = [15, 61, 62];
const WASH: RGB = [244, 246, 248];
const WARN: RGB = [138, 90, 0];

const MARGIN = 12;
const HEADING_SIZE = { 1: 20, 2: 15, 3: 12, 4: 10 } as const;

/** A PDF (landscape A4). jsPDF and its table plugin are loaded only when this format is chosen. */
export async function renderPdf(report: ReportDoc): Promise<Blob> {
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
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
  const font = (style: "normal" | "bold" | "italic", size: number, color: RGB, family = "helvetica") => {
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
        ensure(lineHeight(size) + 12); // keep a heading with what follows it
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
          const mark = b.ordered ? `${i + 1}.` : "-";
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
        font("normal", 8, INK, "courier");
        const rows = b.text.split("\n").flatMap((line) => wrap(line || " ", width - 6));
        const lh = lineHeight(8);
        lines(rows, MARGIN + 3, 8, (lineY) => {
          pdf.setFillColor(...WASH);
          pdf.rect(MARGIN, lineY, width, lh, "F");
          font("normal", 8, INK, "courier");
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
          styles: { font: "helvetica", fontSize: 7, cellPadding: 1.4, textColor: INK, lineColor: [217, 223, 230], lineWidth: 0.15, overflow: "linebreak" },
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
