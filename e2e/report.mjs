/**
 * End-to-end check of Download report, through the real UI, in all four formats.
 *
 *   npm run dev            # in one terminal (or `npm run meridian`)
 *   npm run test:e2e:report
 *
 * Needs Google Chrome (playwright-core with the system Chrome; E2E_CHROME_PATH overrides) and the app at E2E_URL
 * (default http://localhost:3000). It needs no API keys and no eval service: the judge, the OpenAI comparison and a
 * "live" TypeSafe are simulated at the network edge with known scores, so every figure in the downloaded files can be
 * checked against what was fed in. Files and screenshots land in reports/e2e-<timestamp>/ (gitignored) for a look.
 */
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync } from "node:fs";

const require = createRequire(import.meta.url);
// The inner path, as the extract route does: the package root runs a debug block that reads a missing fixture.
const pdfParse = require("pdf-parse/lib/pdf-parse.js");
const mammoth = require("mammoth");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const URL_ = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = process.env.E2E_OUT ?? `reports/e2e-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
mkdirSync(OUT, { recursive: true });

const failures = [];
let checks = 0;
function check(ok, label, detail = "") {
  checks += 1;
  if (!ok) failures.push(`${label}${detail ? ": " + detail : ""}`);
}

// ---- simulated judge and comparison model ---------------------------------

const SCORES = { risk: { typesafe: 0.9, openai: 0.5 }, compliance: { typesafe: 0.8, openai: 0.7 }, citation: { typesafe: 1, openai: 0.6 }, reply: { typesafe: 0.85, openai: 0.85 } };
const REASONS = {
  "risk|typesafe": "Each rating traces to the clauses: uncapped liability in § 9 supports 59%, and the one-way indemnity in § 11 supports 90%.",
  "risk|openai": "The liability rating is too low given the uncapped exposure in § 9; the total is right but built on that understated input.",
  "compliance|typesafe": "All four flags match the text.",
  "compliance|openai": "Flagged “auto-renewal” per § 12 — café, Ω, Жук; the 日本語 clause was not assessed.",
  "citation|typesafe": "The section states the quoted cap verbatim.",
  "citation|openai": "The relation is right, but the verdict omits the exclusion in the same section.",
  "reply|typesafe": "Every figure in the reply matches the analysis.",
  "reply|openai": "Every figure in the reply matches the analysis.",
};
const evaluated = []; // what the judge was asked, in order

function judged(kind, backend) {
  const score = SCORES[kind][backend];
  return {
    ok: true,
    result: {
      score, reason: REASONS[`${kind}|${backend}`], success: score >= 0.6, threshold: 0.6, judgeModel: "gpt-5-mini",
      rubric: { id: kind, version: "2", title: `${kind} rubric` },
      steps: [`Find the ${kind} evidence in the source text.`, "Compare it with the answer."],
      bands: [{ low: 0, high: 5, outcome: "Mostly unsupported" }, { low: 6, high: 10, outcome: "Supported by the text" }],
      integrity: { status: kind === "compliance" && backend === "openai" ? "suspicious" : "clean", signals: kind === "compliance" && backend === "openai" ? [{ field: "SOURCE TEXT", signal: "dictates_score" }] : [], hiddenCharsRemoved: 0 },
      latencyMs: 4200, judgeCostUsd: 0.000412,
    },
  };
}

const openaiAnswers = {
  liability_exposure: { value: 1, selfReportedConfidence: 0.8 },
  indemnification_harshness: { value: 2, selfReportedConfidence: 0.8 },
  termination_rigidity: { value: 1, selfReportedConfidence: 0.8 },
  auto_renewal_trap: { value: true, selfReportedConfidence: 0.8 },
  unlimited_liability: { value: true, selfReportedConfidence: 0.8 },
  missing_data_protection_clause: { value: false, selfReportedConfidence: 0.8 },
  missing_governing_law: { value: false, selfReportedConfidence: 0.8 },
};
const openaiOutcome = (answers) => ({ ok: true, result: { model: "gpt-5", answers, usage: { input_tokens: 2100, output_tokens: 610 }, elapsedMs: 6400, source: "live", requestBytes: 9000 } });

async function simulate(page) {
  await page.route("**/api/evaluate", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { health: { status: "ready", judgeModel: "gpt-5-mini", threshold: 0.6, rubrics: {} } } });
    const body = route.request().postDataJSON();
    evaluated.push({ kind: body.kind, backend: body.backend });
    await new Promise((r) => setTimeout(r, 300));
    return route.fulfill({ json: { outcome: judged(body.kind, body.backend) } });
  });
  // The real chat route answers from the local heuristic; report it as a live TypeSafe answer so it is judged.
  await page.route("**/api/chat", async (route) => {
    const res = await route.fetch();
    const data = await res.json();
    data.live = true;
    data.openaiConfigured = true;
    if (data.result) data.result.source = "live";
    return route.fulfill({ response: res, json: data });
  });
  await page.route("**/api/compare-openai", (route) =>
    route.fulfill({ json: { outcome: openaiOutcome(openaiAnswers), turn: { reply: "OpenAI's reply: the contract is high risk.", intent: { choice: "analyze_contract", confidence: 0.8 }, risk: null, complianceFlags: [], blocked: null } } }),
  );
  // Citations: TypeSafe's batch is answered by the app itself (reported as live so it is judged); OpenAI's is simulated.
  await page.route("**/api/citations", async (route) => {
    const body = route.request().postDataJSON();
    if (body.backend === "typesafe") {
      const res = await route.fetch();
      const data = await res.json();
      if (data.ok) data.source = "live";
      return route.fulfill({ response: res, json: data });
    }
    const judged = Object.fromEntries(body.checks.map((c) => [c.id, { relation: "contradicts", verdict: "contradicted", confidence: 0.9, basis: "self-reported" }]));
    return route.fulfill({ json: { ok: true, judged, model: "gpt-5", source: "live", elapsedMs: 3100, usage: { input_tokens: 800, output_tokens: 60 }, inputBytes: 2000 } });
  });
}

// ---- drive the app --------------------------------------------------------

const browser = await chromium.launch(process.env.E2E_CHROME_PATH ? { executablePath: process.env.E2E_CHROME_PATH, headless: true } : { channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(e.message));
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
await simulate(page);
await page.goto(URL_, { waitUntil: "networkidle" });

const WAIT = 20_000;

const menuButton = page.getByRole("button", { name: "Download report" });
check(await menuButton.isDisabled(), "Download report is disabled before anything has run");

await page.getByText("SaaS Master Services Agreement", { exact: false }).first().click();

/** What the app itself shows for the open tab: each backend's score and the judge's explanation. */
async function readEvaluations(activity) {
  const found = [];
  for (const model of ["TypeSafe", "OpenAI"]) {
    // A card on the Risk, Compliance and Citations tabs, or a table row group on the Trace tab: both carry this label.
    const card = page.locator(`[aria-label="${model} evaluation"]`).first();
    if (!(await card.count()) || !(await card.locator("[role=meter]").count())) continue;
    const score = Number(await card.locator("[role=meter]").first().getAttribute("aria-valuenow"));
    const reason = (await card.locator("[data-verdict]").first().innerText()).trim();
    found.push({ activity, model, score, reason });
  }
  return found;
}
const onScreen = [];
for (const [tab, activity] of [["Risk", "Risk score"], ["Compliance", "Compliance flags"], ["Citations", "Citation verdict"], ["Trace", "Assistant reply"]]) {
  await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click().catch(() => page.getByRole("button", { name: new RegExp(`^${tab}`) }).first().click());
  await page.locator("[data-verdict]").first().waitFor({ timeout: WAIT }).catch(() => {});
  // Both backends' judge calls have to land before the tab is read.
  await page.waitForFunction(() => !document.body.innerText.includes("The judge is re-deriving"), null, { timeout: WAIT }).catch(() => {});
  await page.waitForTimeout(2500);
  onScreen.push(...(await readEvaluations(activity)));

  // Every results tab is drawn the same way: one comparison table (item, TypeSafe, OpenAI, match), then one evaluation table.
  const panel = page.getByRole("tabpanel");
  const headings = async (table) => (await table.locator("thead th").allInnerTexts()).map((t) => t.trim().toLowerCase());
  const compare = await headings(panel.locator("table").first());
  const firstColumn = { Risk: "rating", Compliance: "check", Citations: "check", Trace: "question" }[tab];
  check(compare.join("|") === `${firstColumn}|typesafe|openai|match`, `${tab}: the results use the shared comparison table`, compare.join("|"));
  check((await headings(panel.locator('table[aria-label="Evaluation scores"]'))).join("|") === "model|score|result|judge time|judge cost", `${tab}: the evaluation uses the shared score table`);
  check((await panel.locator("table").count()) === 2, `${tab}: exactly the comparison and the evaluation, no leftover card layout`, String(await panel.locator("table").count()));
}
check(!(await menuButton.isDisabled()), "Download report is enabled once models have run");
const kindsJudged = new Set(evaluated.map((e) => e.kind));
check(["risk", "compliance", "citation"].every((k) => kindsJudged.has(k)), "the app judged risk, compliance and citation", [...kindsJudged].join(","));
check(onScreen.length >= 1, "at least one evaluation is scored on screen", String(onScreen.length));

// The menu.
await menuButton.click();
const dialog = page.getByRole("dialog", { name: "Download report" });
check(await dialog.isVisible(), "the format menu opens");
check((await dialog.getByRole("button").count()) === 4, "the menu offers four formats");
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/menu.png`, clip: { x: 940, y: 0, width: 500, height: 330 } });
await page.evaluate(axeSource);
const axe = await page.evaluate(async () => (await window.axe.run(document.body, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((v) => `${v.id}: ${v.nodes.length}`));
check(axe.length === 0, "the open menu has no accessibility violations", axe.join(", "));
await page.keyboard.press("Escape");
check(!(await dialog.isVisible()), "Escape closes the menu");
check(await menuButton.evaluate((el) => el === document.activeElement), "focus returns to the button when the menu closes");

async function download(label, ext) {
  if (!(await dialog.isVisible())) await menuButton.click();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), dialog.getByRole("button", { name: new RegExp(`^${label}`) }).click()]);
  const path = `${OUT}/report.${ext}`;
  await dl.saveAs(path);
  check(dl.suggestedFilename().endsWith(`.${ext}`) && dl.suggestedFilename().startsWith("meridian-report-"), `${ext}: sensible filename`, dl.suggestedFilename());
  await page.waitForTimeout(300);
  check(!(await dialog.isVisible()), `${ext}: the menu closes after a download`);
  return path;
}
const paths = { html: await download("Web page", "html"), pdf: await download("PDF", "pdf"), docx: await download("Word", "docx"), md: await download("Markdown", "md") };
check(consoleErrors.length === 0, "no console errors in the app", consoleErrors.join(" | "));

// ---- what every format must contain ---------------------------------------

const DATA_ROWS = [["Risk score", "TypeSafe", "90%", "Pass"], ["Risk score", "OpenAI", "50%", "Fail"], ["Compliance flags", "TypeSafe", "80%", "Pass"], ["Compliance flags", "OpenAI", "70%", "Pass"], ["Citation verdict", "TypeSafe", "100%", "Pass"], ["Citation verdict", "OpenAI", "60%", "Pass"]];
const mustContain = ["Meridian evaluation report", "1. Evaluation data", "Risk: scoring and explanation", "Compliance: scoring and explanation", "Citations: scoring and explanation", "Trace", "Model calls, in order", "Reasoning trace", "Analyze this contract"];
// What the simulated judge says, so the exact wording can be checked.
const mockOnly = ["Each rating traces to the clauses", "The section states the quoted cap verbatim.", "Find the risk evidence in the source text.", "gpt-5-mini"];

function verify(format, text) {
  for (const s of [...mustContain, ...mockOnly]) check(text.includes(s), `${format}: contains "${s}"`);
  check(text.indexOf("Evaluation data") < text.indexOf("scoring and explanation"), `${format}: the data table comes before the scoring`);
  check(text.indexOf("Risk: scoring") < text.indexOf("Compliance: scoring") && text.indexOf("Compliance: scoring") < text.indexOf("Citations: scoring"), `${format}: sections are in Risk, Compliance, Citations order`);
}

const md = readFileSync(paths.md, "utf8");
verify("md", md);
const rows = md.split("\n").filter((l) => l.startsWith("| ")).map((l) => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim()));
const header = rows.find((r) => r[0] === "Activity");
check(Boolean(header) && header.length === 14, "md: the data table has 14 columns", String(header?.length));
const col = (n) => (header ? header.indexOf(n) : -1); // no table means no evaluation ran, already reported above
for (const [activity, model, score, result] of DATA_ROWS) {
  const row = rows.find((r) => r[0] === activity && r[1] === "Whole document" && r[col("Model")] === model) ?? rows.find((r) => r[0] === activity && r[col("Model")] === model);
  check(Boolean(row), `md: table row ${activity} / ${model}`);
  if (row) {
    check(row[col("Score")] === score, `md: ${activity} / ${model} score is ${score}`, row[col("Score")]);
    check(row[col("Result")] === result, `md: ${activity} / ${model} result is ${result}`, row[col("Result")]);
    check(row[col("Status")] === "Scored", `md: ${activity} / ${model} is Scored`, row[col("Status")]);
    check(row.every((c) => c.length <= 90), `md: ${activity} / ${model} cells are clipped`, String(Math.max(...row.map((c) => c.length))));
  }
}
check(md.includes("**Head to head.** TypeSafe scored 40 points higher than OpenAI (90% vs 50%)"), "md: risk head-to-head matches the scores");
check(md.includes("Suspicious"), "md: the integrity warning reaches the table");
check(md.includes("café, Ω, Жук") && md.includes("日本語"), "md: non-Latin-1 text is intact");

// Whatever the judge said, the report must say the same as the app: every score and explanation on screen is in the table and the explanations.
const squash = (t) => t.replace(/\s+/g, " ").trim();
const mdText = squash(md);
for (const e of onScreen) {
  const row = rows.find((r) => r[0] === e.activity && r[1] !== "Excerpt" && r[col("Model")] === e.model);
  check(Boolean(row), `on-screen ${e.activity} / ${e.model} has a row in the report`);
  if (row) {
    check(row[col("Score")] === `${e.score}%`, `report score for ${e.activity} / ${e.model} equals the ${e.score}% on screen`, row[col("Score")]);
    check(row[col("Status")] === "Scored", `${e.activity} / ${e.model} is marked Scored`, row[col("Status")]);
  }
  check(mdText.includes(squash(e.reason)), `the judge's full explanation for ${e.activity} / ${e.model} is in the report, unchanged`);
}
check(rows.filter((r) => r[col("Model")] === "TypeSafe").length === rows.filter((r) => r[col("Model")] === "OpenAI").length, "every activity has a row for each model");

const html = readFileSync(paths.html, "utf8");
verify("html", html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " "));
check(!/<script|<link|<img|src=|@import|url\(/i.test(html), "html: fully self-contained");
check((html.match(/class="chip good"/g) ?? []).length >= 5 && html.includes('class="chip bad"'), "html: pass and fail are marked");
check(html.includes("café, Ω, Жук") && html.includes("日本語"), "html: non-Latin-1 text is intact");
const htmlText = squash(html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'));
for (const e of onScreen) check(htmlText.includes(squash(e.reason)), `html: explanation for ${e.activity} / ${e.model} matches the screen`);

const docx = (await mammoth.extractRawText({ buffer: readFileSync(paths.docx) })).value;
verify("docx", docx);
check(docx.includes("café, Ω, Жук") && docx.includes("日本語"), "docx: non-Latin-1 text is intact");
for (const e of onScreen) check(squash(docx).includes(squash(e.reason)), `docx: explanation for ${e.activity} / ${e.model} matches the screen`);

const pdf = await pdfParse(readFileSync(paths.pdf));
verify("pdf", pdf.text);
check(pdf.numpages >= 2, "pdf: paginates", String(pdf.numpages));
check(pdf.text.includes("café, Ω, Жук"), "pdf: Latin, Greek and Cyrillic are drawn, not replaced");
check(pdf.text.includes("the ��� clause") && /Note: 3 characters in this report \(U\+65E5 U\+672C U\+8A9E\)/.test(pdf.text), "pdf: CJK the font cannot draw is marked, and the note names it by code point");
check(pdf.text.includes("§ 9") && pdf.text.includes("“auto-renewal”") && pdf.text.includes("—"), "pdf: § and curly quotes and dashes are drawn");
// PDF text extraction breaks lines mid-sentence and normalises the ellipsis, so compare on a plain alphanumeric skeleton.
const skeleton = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
for (const e of onScreen) check(skeleton(pdf.text).includes(skeleton(e.reason).slice(0, 120)), `pdf: explanation for ${e.activity} / ${e.model} matches the screen`);
check(statSync(paths.pdf).size < 1_500_000, "pdf: a reasonable size (fonts are subset)", `${statSync(paths.pdf).size} bytes`);
check(/Page 1 of \d+/.test(pdf.text), "pdf: has page numbers");

// ---- how they look --------------------------------------------------------

const view = await ctx.newPage();
for (const [name, w, h] of [["desktop", 1280, 900], ["phone", 390, 844]]) {
  await view.setViewportSize({ width: w, height: h });
  await view.goto(`file://${process.cwd()}/${paths.html}`);
  const overflow = await view.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 1, `html: no sideways page scroll on ${name}`, `${overflow}px`);
  if (name === "desktop") {
    const tableScroll = await view.evaluate(() => { const s = document.querySelector(".scroll"); return s.scrollWidth - s.clientWidth; });
    check(tableScroll <= 1, "html: the whole data table fits at 1280px", `${tableScroll}px hidden`);
  }
  await view.screenshot({ path: `${OUT}/html-${name}.png`, fullPage: name === "phone" });
}
await view.setViewportSize({ width: 1500, height: 1050 });
for (let p = 1; p <= Math.min(pdf.numpages, 12); p++) {
  await view.goto("about:blank"); // a hash-only change would not reload the viewer, so every page would be page 1
  await view.goto(`file://${process.cwd()}/${paths.pdf}#page=${p}&view=Fit&toolbar=0`);
  await view.waitForTimeout(1200);
  await view.screenshot({ path: `${OUT}/pdf-page-${p}.png` });
}
await browser.close();

console.log(`files: ${OUT}`);
console.log(failures.length ? `\n${failures.length} of ${checks} checks FAILED:\n - ${failures.join("\n - ")}` : `\nall ${checks} checks passed`);
process.exit(failures.length ? 1 : 0);
