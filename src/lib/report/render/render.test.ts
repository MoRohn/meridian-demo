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
import { readFileSync } from "node:fs";
import { glyphCoverage, makePdfText, PDF_FONT_FILES, type PdfFonts } from "./pdfFonts";

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
const fonts = Object.fromEntries(Object.entries(PDF_FONT_FILES).map(([k, file]) => [k, new Uint8Array(readFileSync(`public/fonts/${file}`))])) as unknown as PdfFonts;
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
    const blob = await renderReport(doc, "pdf", { fonts });
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
    const parsed = await pdfParse(Buffer.from(await bytes(await renderReport(buildReportDoc({ ...input, activities: many }), "pdf", { fonts }))));
    expect(parsed.numpages).toBeGreaterThan(2);
    expect(parsed.text).toContain("Call number 60");
  });
  it("draws typographic and non-Latin-1 characters instead of replacing them", async () => {
    const text = "\u201cquoted\u201d a \u2192 b \u2265 3 \u2014 \u00a7 9.2, \u20ac500, \u03a9 \u0416\u0443\u043a caf\u00e9";
    const uni = buildReportDoc({ ...input, evals: [row("risk", "typesafe", "risk", result(0.8, { reason: text }))] });
    const parsed = await pdfParse(Buffer.from(await bytes(await renderReport(uni, "pdf", { fonts }))));
    expect(parsed.text).toContain(text);
    expect(parsed.text).not.toContain("Note:"); // nothing needed replacing, so no note
  });
  it("marks what the font truly cannot draw, and says so at the end", async () => {
    const cjk = buildReportDoc({ ...input, evals: [row("risk", "typesafe", "risk", result(0.8, { reason: "Governing law: \u65e5\u672c\u6cd5 applies" }))] });
    const parsed = await pdfParse(Buffer.from(await bytes(await renderReport(cjk, "pdf", { fonts }))));
    expect(parsed.text).toContain("Governing law: \ufffd\ufffd\ufffd applies");
    expect(parsed.text).toMatch(/Note: 3 characters in this report \(U\+65E5 U\+672C U\+6CD5\) have no glyph/);
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

describe("PDF text safety", () => {
  const covers = glyphCoverage(fonts.regular);
  it("reads real coverage from the embedded font", () => {
    expect([covers(0x41), covers(0x00e9), covers(0x2192), covers(0x20ac), covers(0x0416)]).toEqual([true, true, true, true, true]);
    expect(covers(0x65e5)).toBe(false); // CJK
  });
  it("cleans text for drawing without dropping anything visible", () => {
    const t = makePdfText(covers);
    expect(t.clean("a\u0000b\u200bc\u00adz\n\u00e9")).toBe("a bcz\n\u00e9");
    expect(t.replaced()).toEqual([]);
  });
  it("replaces right-to-left scripts, which would draw backwards without shaping", () => {
    const t = makePdfText(covers);
    expect(t.clean("\u05e9\u05dc\u05d5\u05dd")).toBe("\ufffd\ufffd\ufffd\ufffd");
    expect(t.replaced()).toHaveLength(4);
  });
  it("replaces emoji even though the font has some, since a PDF text run cannot carry characters beyond the BMP", () => {
    const t = makePdfText(covers);
    expect(t.clean("ok \u{1F600}")).toBe("ok \ufffd");
  });
  it("lists each replaced character once, however often it appears", () => {
    const t = makePdfText(covers);
    t.clean("\u65e5\u65e5\u65e5");
    t.clean("\u65e5");
    expect(t.replaced()).toEqual(["\u65e5"]);
  });
});
