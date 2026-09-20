// @vitest-environment node
import mammoth from "mammoth";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "../../activity/log";
import type { StoredEvaluationRow } from "../../eval/store";
import type { EvalResult } from "../../eval/types";
import { buildReportDoc } from "../buildReport";
import { renderReport, REPORT_FORMATS } from "../formats";
import { renderHtml } from "./html";
import { pdfSafe } from "./pdf";

// The inner path, as the extract route does: the package root runs a debug block that reads a missing fixture.
const pdfParse = createRequire(import.meta.url)("pdf-parse/lib/pdf-parse.js") as (data: Buffer) => Promise<{ text: string; numpages: number }>;

const result = (score: number, over: Partial<EvalResult> = {}): EvalResult => ({
  score, reason: "The ratings match the liability clause in section 9.", success: score >= 0.6, threshold: 0.6, judgeModel: "gpt-judge",
  rubric: { id: "risk", version: "2", title: "Risk rubric" }, steps: ["Find the clause", "Compare the rating"],
  bands: [{ low: 0, high: 5, outcome: "Wrong" }, { low: 6, high: 10, outcome: "Supported" }],
  integrity: { status: "clean", signals: [], hiddenCharsRemoved: 0 }, latencyMs: 1500, judgeCostUsd: 0.000123, ...over,
});
const row = (scope: string, backend: "typesafe" | "openai", kind: "risk" | "citation", r: EvalResult): StoredEvaluationRow => ({
  scope, backend, kind, sig: "s", pending: false, auto: false, outcome: { ok: true, result: r },
  packet: { input: "Rate the risk", actualOutput: "Overall risk: 70%", contextChars: 12345 },
});
const at = Date.UTC(2026, 8, 20, 14, 30, 5);
const activity: ActivityRecord = { id: 1, actor: "typesafe", kind: "chat", label: "Analyze this contract", status: "done", startedAt: at, endedAt: at + 900, modelMs: 900, model: "jev" };

const input = {
  generatedAt: at,
  document: { name: "msa.pdf", contractType: "MSA" },
  evals: [row("risk", "typesafe", "risk", result(0.85)), row("risk", "openai", "risk", result(0.4)), row("citation", "typesafe", "citation", result(0.9))],
  activities: [activity],
  trace: [],
};
const doc = buildReportDoc(input);
const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe("HTML report", () => {
  const html = renderHtml(doc);
  it("is one self-contained page: inline styles, no scripts, no external files", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<script|<link|<img|src=|@import|url\(/i);
  });
  it("leads with the data table, and marks pass and fail so they read at a glance", () => {
    expect(html.indexOf("<table>")).toBeLessThan(html.indexOf("Risk: scoring and explanation"));
    expect(html).toContain('<span class="chip good">Pass</span>');
    expect(html).toContain('<span class="chip bad">Fail</span>');
  });
  it("carries the explanation, rubric steps and the answer that was judged", () => {
    expect(html).toContain("<blockquote><p>The ratings match the liability clause in section 9.</p></blockquote>");
    expect(html).toContain("<li>Find the clause</li>");
    expect(html).toContain("<pre>Overall risk: 70%</pre>");
  });
  it("escapes anything a model or a document could put in it", () => {
    const evil = buildReportDoc({ ...input, evals: [row("risk", "typesafe", "risk", result(0.8, { reason: "<script>alert(1)</script> & \"q\"" }))] });
    const out = renderHtml(evil);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;");
  });
});

describe("Word report", () => {
  it("is a real .docx that contains the table, explanation and trace", async () => {
    const blob = await renderReport(doc, "docx");
    const data = await bytes(blob);
    expect([data[0], data[1]]).toEqual([0x50, 0x4b]); // a zip
    const { value: text } = await mammoth.extractRawText({ buffer: Buffer.from(data) });
    expect(text).toContain("Meridian evaluation report");
    expect(text).toContain("Risk score");
    expect(text).toContain("85%");
    expect(text).toContain("The ratings match the liability clause in section 9.");
    expect(text).toContain("Find the clause");
    expect(text).toContain("Analyze this contract");
  });
});

describe("PDF report", () => {
  it("is a real PDF that contains the table, explanation and trace, across pages when it is long", async () => {
    const blob = await renderReport(doc, "pdf");
    const data = await bytes(blob);
    expect(new TextDecoder().decode(data.slice(0, 5))).toBe("%PDF-");
    const parsed = await pdfParse(Buffer.from(data));
    expect(parsed.text).toContain("Meridian evaluation report");
    expect(parsed.text).toContain("The ratings match the liability clause in section 9.");
    expect(parsed.text).toContain("Analyze this contract");
    expect(parsed.text).toContain("Page 1 of");
  });
  it("paginates a long report without losing its end", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...activity, id: i + 1, label: `Call number ${i + 1}` }));
    const parsed = await pdfParse(Buffer.from(await bytes(await renderReport(buildReportDoc({ ...input, activities: many }), "pdf"))));
    expect(parsed.numpages).toBeGreaterThan(2);
    expect(parsed.text).toContain("Call number 60");
  });
  it("keeps stray symbols from garbling a line", () => {
    expect(pdfSafe("“quoted” … a → b ≥ 3 — ok")).toBe('"quoted" ... a -> b >= 3 - ok');
    expect(pdfSafe("日本語 é")).toBe("??? é");
  });
});

describe("REPORT_FORMATS", () => {
  it("offers the web page first, then PDF, Word and Markdown", () => {
    expect(REPORT_FORMATS.map((f) => f.id)).toEqual(["html", "pdf", "docx", "md"]);
  });
  it("renders the html and markdown formats as text with their type", async () => {
    const html = await renderReport(doc, "html");
    const md = await renderReport(doc, "md");
    expect(html.type).toContain("text/html");
    expect(md.type).toContain("text/markdown");
    expect(await md.text()).toContain("# Meridian evaluation report");
  });
});
