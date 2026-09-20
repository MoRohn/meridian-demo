import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { Block, ReportDoc } from "../doc";

/** Landscape A4 with 0.5 inch margins, in twentieths of a point: the width the wide data table has to fit in. */
const MARGIN = 720;
const PAGE_WIDTH = 16838 - 2 * MARGIN;

const INK = "1C2530";
const MUTED = "5D6B7A";
const DEEP = "0F3D3E";
const WASH = "F4F6F8";
const LINE = "D9DFE6";
const FONT = "Calibri";

const HEADINGS = {
  1: { level: HeadingLevel.HEADING_1, size: 44 },
  2: { level: HeadingLevel.HEADING_2, size: 32 },
  3: { level: HeadingLevel.HEADING_3, size: 26 },
  4: { level: HeadingLevel.HEADING_4, size: 22 },
} as const;

/** Column widths in proportion to how much each column holds, so short columns stay narrow and the explanation gets the room. */
function columnWidths(columns: string[], rows: string[][]): number[] {
  const weights = columns.map((c, i) => Math.min(34, Math.max(c.length, 4, ...rows.map((r) => (r[i] ?? "").length)) * 0.85 + 2));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.floor((w / total) * PAGE_WIDTH));
}

function tableBlock(b: Extract<Block, { type: "table" }>): Table {
  const widths = columnWidths(b.columns, b.rows);
  const cell = (text: string, i: number, head: boolean, shade: boolean) =>
    new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      margins: { top: 50, bottom: 50, left: 80, right: 80 },
      shading: head ? { type: ShadingType.CLEAR, fill: DEEP, color: "auto" } : shade ? { type: ShadingType.CLEAR, fill: WASH, color: "auto" } : undefined,
      children: [new Paragraph({ children: [new TextRun({ text, size: 16, bold: head, color: head ? "FFFFFF" : INK, font: FONT })] })],
    });
  return new Table({
    width: { size: PAGE_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      left: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      right: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: LINE },
    },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: b.columns.map((c, i) => cell(c, i, true, false)) }),
      ...b.rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((v, i) => cell(v, i, false, ri % 2 === 1)) })),
    ],
  });
}

function blocks(doc: ReportDoc): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  let listInstance = 0;
  for (const b of doc.blocks) {
    switch (b.type) {
      case "heading":
        out.push(new Paragraph({ heading: HEADINGS[b.level].level, spacing: { before: b.level === 1 ? 0 : 280, after: 100 }, keepNext: true, children: [new TextRun({ text: b.text, bold: true, size: HEADINGS[b.level].size, color: b.level === 4 ? MUTED : DEEP, font: FONT })] }));
        break;
      case "paragraph": {
        const color = b.tone === "warn" ? "8A5A00" : b.tone === "muted" ? MUTED : INK;
        out.push(
          new Paragraph({
            spacing: { before: 60, after: 60 },
            shading: b.tone === "warn" ? { type: ShadingType.CLEAR, fill: "FDF6E7", color: "auto" } : undefined,
            children: [
              ...(b.lead ? [new TextRun({ text: b.text ? `${b.lead} ` : b.lead, bold: true, color, size: 21, font: FONT })] : []),
              ...(b.text ? [new TextRun({ text: b.text, color, size: b.tone === "muted" ? 19 : 21, font: FONT })] : []),
            ],
          }),
        );
        break;
      }
      case "list": {
        const instance = b.ordered ? ++listInstance : 0;
        for (const item of b.items) {
          out.push(
            new Paragraph({
              spacing: { before: 20, after: 20 },
              ...(b.ordered ? { numbering: { reference: "ordered", level: 0, instance } } : { bullet: { level: 0 } }),
              children: [new TextRun({ text: item, size: 21, color: INK, font: FONT })],
            }),
          );
        }
        break;
      }
      case "quote":
        for (const line of b.text.split(/\n+/)) {
          out.push(
            new Paragraph({
              spacing: { before: 40, after: 40 },
              indent: { left: 240 },
              border: { left: { style: BorderStyle.SINGLE, size: 18, color: DEEP, space: 8 } },
              shading: { type: ShadingType.CLEAR, fill: WASH, color: "auto" },
              children: [new TextRun({ text: line, italics: true, size: 21, color: INK, font: FONT })],
            }),
          );
        }
        break;
      case "code":
        for (const line of b.text.split("\n")) {
          out.push(
            new Paragraph({
              spacing: { before: 0, after: 0, line: 260 },
              indent: { left: 120, right: 120 },
              shading: { type: ShadingType.CLEAR, fill: WASH, color: "auto" },
              children: [new TextRun({ text: line || " ", font: "Courier New", size: 17, color: INK })],
            }),
          );
        }
        out.push(new Paragraph({ spacing: { before: 0, after: 60 }, children: [] }));
        break;
      case "table":
        out.push(tableBlock(b), new Paragraph({ spacing: { before: 0, after: 80 }, children: [] }));
        break;
    }
  }
  return out;
}

/** A Word document (.docx). The `docx` library is loaded only when this format is chosen. */
export async function renderDocx(doc: ReportDoc): Promise<Blob> {
  const file = new Document({
    creator: "Meridian",
    title: doc.title,
    numbering: { config: [{ reference: "ordered", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START }] }] },
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [
      {
        properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
        children: blocks(doc),
      },
    ],
  });
  return Packer.toBlob(file);
}
