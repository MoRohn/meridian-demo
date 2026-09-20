import type { PageLayout } from "./paginate";

/**
 * What a rendered sheet can hold, in units that do not change with the zoom: the width and height available to text in pixels,
 * and how wide a character and how tall a line are as fractions of the font size. The layout at any zoom follows from these,
 * so changing the zoom re-flows the pages at once and a later measurement only corrects small differences.
 */
export interface SheetMetrics {
  contentWidth: number;
  contentHeight: number;
  charEm: number;
  lineEm: number;
}

/** US Letter, the shape of every sheet. */
export const SHEET_RATIO = 11 / 8.5;
/** Room the sheet's "Page n of m" footer takes below the text. */
export const SHEET_FOOTER_PX = 40;
/** Text wider than the average, such as capitals, must not overflow a line the layout thought would fit. */
const WIDTH_SAFETY = 0.94;

/** Reasonable values for the first paint, before a sheet has been measured. */
export const ESTIMATED_METRICS: SheetMetrics = { contentWidth: 720, contentHeight: 750, charEm: 0.52, lineEm: 1.625 };

export function layoutFor(metrics: SheetMetrics | null, zoom: number): PageLayout {
  const m = metrics ?? ESTIMATED_METRICS;
  return {
    cols: Math.floor((m.contentWidth / (zoom * m.charEm)) * WIDTH_SAFETY),
    rows: Math.floor(m.contentHeight / (zoom * m.lineEm)),
  };
}

const SAMPLE = "The Customer shall indemnify and hold harmless the Provider, its officers and employees (30) days after 1234567890 written notice. ";

/** Reads a rendered sheet and its text block. Null when either has no size yet, as in a hidden pane. */
export function measureSheet(sheet: HTMLElement, text: HTMLElement): SheetMetrics | null {
  const width = sheet.getBoundingClientRect().width;
  const contentWidth = text.clientWidth;
  if (width <= 0 || contentWidth <= 0) return null;

  const sheetStyle = getComputedStyle(sheet);
  const textStyle = getComputedStyle(text);
  const fontSize = parseFloat(textStyle.fontSize) || 16;
  const contentHeight = width * SHEET_RATIO - parseFloat(sheetStyle.paddingTop) - parseFloat(sheetStyle.paddingBottom) - SHEET_FOOTER_PX;

  let charEm = ESTIMATED_METRICS.charEm;
  const context = document.createElement("canvas").getContext("2d");
  if (context) {
    context.font = `${textStyle.fontStyle} ${textStyle.fontWeight} ${fontSize}px ${textStyle.fontFamily}`;
    const measured = context.measureText(SAMPLE).width / SAMPLE.length / fontSize;
    if (Number.isFinite(measured) && measured > 0.2) charEm = measured;
  }
  const lineHeight = parseFloat(textStyle.lineHeight);
  const lineEm = Number.isFinite(lineHeight) ? lineHeight / fontSize : ESTIMATED_METRICS.lineEm;

  return { contentWidth, contentHeight, charEm, lineEm };
}

/** Whether two measurements differ enough to be worth re-flowing the pages for. */
export function differs(a: SheetMetrics | null, b: SheetMetrics): boolean {
  return !a || Math.abs(a.contentWidth - b.contentWidth) > 1 || Math.abs(a.contentHeight - b.contentHeight) > 1 || Math.abs(a.charEm - b.charEm) > 0.005 || Math.abs(a.lineEm - b.lineEm) > 0.005;
}
