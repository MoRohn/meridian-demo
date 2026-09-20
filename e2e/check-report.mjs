/**
 * Checks a report you downloaded from your own session, whatever produced its scores.
 *
 *   npm run check:report -- ~/Downloads/meridian-report-....html      (.html, .pdf, .docx or .md)
 *
 * It needs no keys and no running app. Use the report your own app produced: the keys saved in the Settings modal (the
 * gear icon) are what ran the real judge, so nothing about keys is asked for here. The checks are judge-agnostic: they
 * test that the report is complete, well formed and internally consistent (the table agrees with the scoring sections,
 * pass/fail agrees with the threshold, the band agrees with the score), not what any particular score should be.
 * Tables are read from .html and .md; .pdf and .docx are checked as text.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run check:report -- <report.html|.pdf|.docx|.md>");
  process.exit(2);
}
const ext = path.extname(file).slice(1).toLowerCase();
const failures = [];
let checks = 0;
const check = (ok, label, detail = "") => {
  checks += 1;
  if (!ok) failures.push(`${label}${detail ? ": " + detail : ""}`);
};

const unescapeHtml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const stripTags = (s) => unescapeHtml(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

let text;
let rows = null; // the data table, when the format keeps one
let pages = null;
if (ext === "md") {
  text = readFileSync(file, "utf8");
  // The first table in the file is the data table: its first run of consecutive table lines, minus the separator row.
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("| "));
  const block = [];
  for (let i = start; i >= 0 && i < lines.length && lines[i].startsWith("|"); i++) block.push(lines[i]);
  rows = block.map((l) => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim().replace(/\\\|/g, "|"))).filter((r) => r[0] !== "---");
} else if (ext === "html") {
  const html = readFileSync(file, "utf8");
  text = stripTags(html);
  check(!/<script|<link|<img|src=|@import|url\(/i.test(html), "the web page is fully self-contained");
  const firstTable = html.match(/<table>(.*?)<\/table>/s)?.[1];
  if (firstTable) rows = [...firstTable.matchAll(/<tr>(.*?)<\/tr>/gs)].map((m) => [...m[1].matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/gs)].map((c) => stripTags(c[1])));
} else if (ext === "docx") {
  text = (await require("mammoth").extractRawText({ buffer: readFileSync(file) })).value;
} else if (ext === "pdf") {
  const parsed = await require("pdf-parse/lib/pdf-parse.js")(readFileSync(file)); // the inner path: the package root runs a debug block
  text = parsed.text;
  pages = parsed.numpages;
} else {
  console.error(`Unsupported file type ".${ext}". Use .html, .pdf, .docx or .md.`);
  process.exit(2);
}
const flat = text.replace(/\s+/g, " ");

// ---- structure -------------------------------------------------------------
const order = ["Meridian evaluation report", "1. Evaluation data", "Risk: scoring and explanation", "Compliance: scoring and explanation", "Citations: scoring and explanation", "Model calls, in order", "Reasoning trace"];
let last = -1;
for (const heading of order) {
  const at = flat.indexOf(heading, last + 1);
  check(at > last, `"${heading}" is present, in order`);
  if (at > last) last = at;
}
check(!/\b(undefined|NaN|\[object)\b/.test(flat), "no undefined, NaN or [object] leaked into the report");
if (pages) {
  check(new RegExp(`Page ${pages} of ${pages}`).test(flat), "page numbers run to the last page", `${pages} pages`);
  const marks = (flat.match(/�/g) ?? []).length;
  if (marks) console.log(`note: ${marks} placeholder character(s) in the PDF (text its font cannot draw; the web page and Word versions keep it)`);
}

// ---- the data table ----------------------------------------------------------
const scoredBlocks = [...flat.matchAll(/Score: (\d{1,3})% \((\d+)\/10\), (Pass|Fail)\./g)].map((m) => ({ score: Number(m[1]), tenths: Number(m[2]), result: m[3] }));
check(scoredBlocks.every((b) => b.tenths === Math.round(b.score / 10)), "every scoring section's N/10 agrees with its percentage");

if (rows) {
  const header = rows[0];
  check(header?.length === 13, "the data table has 13 columns", String(header?.length));
  const col = (n) => header.indexOf(n);
  const body = rows.slice(1);
  check(body.length > 0, "the data table has rows (an evaluation ran)");
  check(body.length % 2 === 0, "one row per model for every activity", `${body.length} rows`);
  let scored = 0;
  for (const r of body) {
    const id = `${r[0]} / ${r[col("Scope")]} / ${r[col("Model")]}`;
    check(["TypeSafe", "OpenAI"].includes(r[col("Model")]), `${id}: model is TypeSafe or OpenAI`);
    check(r.every((c) => c.length <= 90), `${id}: cells are clipped`, String(Math.max(...r.map((c) => c.length))));
    if (r[col("Status")] !== "Scored") {
      check(r[col("Score")] === "n/a" && r[col("Result")] === "n/a", `${id}: an unscored row shows n/a, never a made-up score`, `${r[col("Status")]}: ${r[col("Score")]}`);
      continue;
    }
    scored += 1;
    const score = parseInt(r[col("Score")], 10);
    const pass = parseInt(r[col("Pass at")], 10);
    check(/^\d{1,3}%$/.test(r[col("Score")]) && score <= 100, `${id}: score is a percentage`, r[col("Score")]);
    check(r[col("Result")] === (score >= pass ? "Pass" : "Fail"), `${id}: ${r[col("Result")]} agrees with ${score}% against a ${pass}% threshold`);
    const [lo, hi] = r[col("Band (0-10)")].split("-").map(Number);
    const tenths = Math.round(score / 10);
    check(tenths >= lo && tenths <= hi, `${id}: band ${r[col("Band (0-10)")]} contains ${tenths}/10`);
    check(scoredBlocks.some((b) => b.score === score && b.result === r[col("Result")]), `${id}: a scoring section reports ${score}% ${r[col("Result")]}`);
    check(r[col("Judge's explanation")] !== "n/a", `${id}: has the judge's explanation`);
  }
  check(scoredBlocks.length === scored, "the scoring sections and the table agree on how many answers were scored", `${scoredBlocks.length} vs ${scored}`);
} else {
  check(scoredBlocks.length > 0, "at least one scored answer with the judge's explanation");
}

console.log(`${file}\n${failures.length ? `\n${failures.length} of ${checks} checks FAILED:\n - ${failures.join("\n - ")}` : `all ${checks} checks passed`}`);
process.exit(failures.length ? 1 : 0);
