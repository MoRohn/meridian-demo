import type { ReportDoc, ReportFormat } from "./doc";
import { renderHtml } from "./render/html";
import { renderMarkdown } from "./render/markdown";
import { fetchPdfFonts, type PdfFonts } from "./render/pdfFonts";

export interface ReportFormatInfo {
  id: ReportFormat;
  label: string;
  hint: string;
  mime: string;
}

/** The formats offered by Download report, in menu order. The first is the default. */
export const REPORT_FORMATS: readonly ReportFormatInfo[] = [
  { id: "html", label: "Web page (.html)", hint: "Opens in any browser. Best for reading and sharing.", mime: "text/html;charset=utf-8" },
  { id: "pdf", label: "PDF (.pdf)", hint: "A fixed layout for printing or filing.", mime: "application/pdf" },
  { id: "docx", label: "Word (.docx)", hint: "Editable in Word, Google Docs or Pages.", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { id: "md", label: "Markdown (.md)", hint: "Plain text with a table, for developers.", mime: "text/markdown;charset=utf-8" },
];

/** Renders the report as a downloadable file. PDF and Word load their libraries only when asked for, so they cost nothing until used. */
export async function renderReport(doc: ReportDoc, format: ReportFormat, options: { fonts?: PdfFonts } = {}): Promise<Blob> {
  const info = REPORT_FORMATS.find((f) => f.id === format)!;
  switch (format) {
    case "html":
      return new Blob([renderHtml(doc)], { type: info.mime });
    case "md":
      return new Blob([renderMarkdown(doc)], { type: info.mime });
    case "pdf":
      return (await import("./render/pdf")).renderPdf(doc, options.fonts ?? (await fetchPdfFonts()));
    case "docx":
      return (await import("./render/docx")).renderDocx(doc);
  }
}
