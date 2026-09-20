/**
 * A report as plain structured content, independent of any file format. The builder (buildReport.ts) produces one of
 * these from the session's data; each renderer (HTML, PDF, Word, Markdown) turns the same blocks into its own format,
 * so the four files can never disagree about what the report says.
 */
export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4; text: string }
  /** `lead` is a short bold label run in front of the text. `tone` "warn" is a caution the reader should not miss. */
  | { type: "paragraph"; text: string; lead?: string; tone?: "muted" | "warn" }
  | { type: "list"; ordered: boolean; items: string[] }
  /** The judge's own words. */
  | { type: "quote"; text: string }
  /** Verbatim text (a request, or a model's answer) that must keep its line breaks. */
  | { type: "code"; text: string }
  | { type: "table"; columns: string[]; rows: string[][] };

export interface ReportDoc {
  title: string;
  blocks: Block[];
}

export type ReportFormat = "html" | "pdf" | "docx" | "md";
