/**
 * End-to-end check of the Citations tab, through the real UI.
 *
 *   npm run dev            # in one terminal (or `npm run meridian`)
 *   npm run test:e2e:citations
 *
 * Needs Google Chrome and the app at E2E_URL (default http://localhost:3000). It needs no API keys: TypeSafe's side is
 * answered by the app's own demo evaluator, and OpenAI's is simulated at the network edge. It checks that the tab reads a
 * document (or a highlighted passage) and checks it on its own, that results survive a tab switch and cost no extra
 * calls, that references and key terms are found and reported the way a reader would expect, and that the tab works on
 * a phone and is accessible. Nothing is typed into the tab: it has no inputs.
 */
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const URL_ = process.env.E2E_URL ?? "http://localhost:3000";
const failures = [];
let checks = 0;
const check = (ok, label, detail = "") => {
  checks += 1;
  if (!ok) failures.push(`${label}${detail ? ": " + detail : ""}`);
};

const browser = await chromium.launch(process.env.E2E_CHROME_PATH ? { executablePath: process.env.E2E_CHROME_PATH, headless: true } : { channel: "chrome", headless: true });

/** A page with OpenAI "configured" and its batch answered by a simulation; every /api/citations POST is counted. */
async function open(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 800 });
  const page = await ctx.newPage();
  const calls = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
  page.on("request", (r) => r.method() === "POST" && r.url().endsWith("/api/citations") && calls.push(r.postDataJSON()));
  await page.route("**/api/chat", async (route) => {
    const res = await route.fetch();
    const data = await res.json();
    data.openaiConfigured = true;
    return route.fulfill({ response: res, json: data });
  });
  await page.route("**/api/citations", async (route) => {
    const body = route.request().postDataJSON();
    if (body.backend === "typesafe") return route.fallback();
    const judged = Object.fromEntries(body.checks.map((c) => [c.id, { relation: "contradicts", verdict: "contradicted", confidence: 0.9, basis: "self-reported" }]));
    return route.fulfill({ json: { ok: true, judged, model: "gpt-5", source: "live", elapsedMs: 3100, usage: { input_tokens: 800, output_tokens: 60 }, inputBytes: 2000 } });
  });
  await page.goto(URL_, { waitUntil: "networkidle" });
  return { ctx, page, calls, errors };
}
const settle = (page) => page.waitForFunction(() => !/checking/.test(document.querySelector('table[aria-label="Citation checks"]')?.textContent ?? "x"), null, { timeout: 20000 }).catch(() => {});
const table = (page) => page.getByRole("table", { name: "Citation checks" });

// ---- a document, on its own ---------------------------------------------------------------------------------------------
{
  const { ctx, page, calls, errors } = await open();
  await page.getByRole("tab", { name: /^Citations/ }).click();
  check((await page.getByText("Load or upload a document, and its citations and key terms are found and checked here automatically.").count()) === 1, "with no document, the tab says what will happen");
  check(calls.length === 0, "nothing is called before there is a document");

  await page.getByText("SaaS Master Services Agreement", { exact: false }).first().click();
  await table(page).waitFor({ timeout: 15000 });
  await settle(page);
  check(calls.map((c) => c.backend).sort().join() === "openai,typesafe", "one batched request per backend, made without a click", calls.map((c) => c.backend).join());
  check(calls.every((c) => c.checks.length >= 6), "each request carries every check of the document", calls.map((c) => c.checks.length).join());

  const text = await table(page).innerText();
  check(/KEY TERMS/i.test(text) && /checked against the playbook/.test(text), "the terms are grouped and say what they are checked against");
  check(!/CITED IN THE TEXT/i.test(text), "no 'cited in the text' group when the text cites nothing");
  check(await page.getByText("No references or citations are written in this text").isVisible(), "it says plainly that the text cites nothing");
  for (const t of ["Playbook §4.2", "Liability cap", "§4 Limitation of Liability", "no cap", "termination fee", "18 months", "one-way", "regardless of fault"]) check(text.includes(t) || text.toUpperCase().includes(t.toUpperCase()), `the table shows "${t}"`);
  check(/eighteen \(18\) months/.test(text), "the clause is quoted verbatim");
  check((await table(page).getByText("Contradicted").count()) >= 3, "the verdicts are in the table, in one vocabulary");
  check(/Missing/.test(text) && /No clause on this was found/.test(text), "an essential term the document lacks is reported missing, with the reason");
  check((await table(page).locator("thead th").allInnerTexts()).map((t) => t.trim().toLowerCase()).join("|") === "check|typesafe|openai|match", "it is the same four-column comparison table as the other tabs");

  const bar = await page.locator("main").innerText();
  check(/contradicted:\s*\d/.test(bar) && /agree:\s*\d\/\d/.test(bar), "the summary bar counts the results and how often the two models agree");

  // Nothing to type into, and none of the old inputs.
  check((await page.locator("textarea").count()) === 0, "there is nothing to type into");
  for (const gone of ["Claim being made", "Verify citation", "Playbook examples", "Suggested from your document"]) check((await page.getByText(gone).count()) === 0, `the old "${gone}" is gone`);

  // The judge scores one check, chosen for being the one that matters, and the reader can choose another.
  const picker = page.getByLabel("Check the judge scores");
  const options = await picker.locator("option").allInnerTexts();
  const selected = await picker.evaluate((el) => el.selectedOptions[0].textContent.replace(/\s+/g, " "));
  check(options.length >= 3 && /Contradicted/.test(selected), "the judge defaults to a contradicted check", selected);
  await picker.selectOption({ index: 0 });
  check(/checks?/.test(await page.locator("main").innerText()) && (await picker.evaluate((el) => el.selectedIndex)) === 0, "the reader can pick another check for the judge to score");
  await picker.selectOption({ label: selected.replace(/\s+/g, " ") }).catch(() => {});

  // Results survive a tab switch and cost nothing to come back to.
  const before = calls.length;
  await page.getByRole("tab", { name: /^Risk/ }).click();
  await page.getByRole("tab", { name: /^Citations/ }).click();
  await page.waitForTimeout(800);
  check((await table(page).count()) === 1 && calls.length === before, "switching tabs and back keeps the results and makes no new calls", `${calls.length - before} extra`);

  // Re-check runs it again.
  await page.getByRole("button", { name: "Re-check" }).click();
  await settle(page);
  await page.waitForTimeout(500);
  check(calls.length === before + 2, "Re-check makes one new request per backend", `${calls.length - before}`);

  // A highlighted passage is read on its own.
  const marked = await page.evaluate(() => {
    const region = document.querySelector('[aria-label="Document preview"]');
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.textContent.indexOf("Provider's total liability");
      if (at >= 0) {
        const range = document.createRange();
        range.setStart(n, at);
        range.setEnd(n, Math.min(n.textContent.length, at + 110));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        region.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return true;
      }
    }
    return false;
  });
  check(marked, "a passage could be highlighted in the document");
  await page.getByText("Read from your highlighted passage.").waitFor({ timeout: 8000 }).catch(() => {});
  await settle(page);
  check(await page.getByText("Read from your highlighted passage.").isVisible(), "a highlighted passage is what gets read");
  const passageRows = await table(page).locator("tbody tr").count();
  check(passageRows === 2, "it checks just that passage: its group header and the one term it covers", `${passageRows} rows`);
  const passageText = await table(page).innerText();
  check(/Liability cap/.test(passageText) && /Selected passage/.test(passageText) && !/Missing/.test(passageText), "a passage is not accused of missing terms it was never meant to contain");
  check(calls.length === before + 4, "the passage is checked with its own request per backend", `${calls.length - before}`);

  check(errors.length === 0, "no page errors", errors.join(" | "));
  await ctx.close();
}

// ---- references written in the text, and text with nothing to check -----------------------------------------------------------
{
  const dir = mkdtempSync(path.join(tmpdir(), "cite-"));
  const upload = async (page, name, body) => {
    const file = path.join(dir, name);
    writeFileSync(file, body);
    await page.getByRole("tab", { name: /^Citations/ }).click();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /upload/i }).first().click()]);
    await chooser.setFiles(file);
  };

  const { ctx, page, calls, errors } = await open();
  await upload(
    page,
    "vendor.txt",
    "1. Scope. The services are described in Section 9 and Exhibit A.\n\n2. Data. Vendor shall comply with GDPR Article 28 and 15 U.S.C. § 1681.\n\n3. Fees. Fees are due within thirty (30) days of invoice.\n\n4. Liability. Vendor's liability shall not exceed $10,000. See Section 3.\n",
  );
  await table(page).waitFor({ timeout: 20000 });
  await settle(page);
  const text = await table(page).innerText();
  check(/CITED IN THE TEXT/i.test(text) && /found/.test(text), "references written in the text get their own group");
  check(/Cites Section 9/.test(text) && /Broken reference/.test(text) && /Section 9 does not exist in this document\./.test(text), "a reference to a section that does not exist is a broken reference");
  check(/Cites §3 Fees/.test(text), "a reference to a real section is checked against what that section says");
  for (const cite of ["GDPR Article 28", "15 U.S.C. § 1681", "Exhibit A"]) check(text.includes(cite), `${cite} is found and listed`);
  check((await table(page).getByText("Not checkable").count()) === 3, "outside sources and attachments are said to be not checkable here, not judged");
  check(/LEGAL CITATION/i.test(text) && /ATTACHMENT/i.test(text) && /CROSS-REFERENCE/i.test(text), "each reference says what kind it is");
  check(/\$10,000/.test(text), "the figure in the liability clause is pulled out");
  const sent = new Set(calls.flatMap((c) => c.checks.map((k) => k.id)));
  check(!["ref_1", "ref_2", "ref_3", "ref_4"].some((id) => sent.has(id)) && sent.has("ref_5") && sent.has("term_liability"), "only what a model can judge is sent to one: not the broken reference, the outside sources or the attachment", [...sent].join(","));
  check(errors.length === 0, "no page errors on a document with references", errors.join(" | "));
  await ctx.close();

  const empty = await open();
  await upload(empty.page, "letter.txt", "Hello.\n\nThis short letter confirms our meeting yesterday and thanks you for your time today, nothing more than that at all.\n");
  await empty.page.getByText("Nothing in this document could be read as a reference or a key term.").waitFor({ timeout: 15000 }).catch(() => {});
  check(await empty.page.getByText("Nothing in this document could be read as a reference or a key term.").isVisible(), "a document with nothing to check says so");
  check(empty.calls.length === 0, "and makes no model call for it", `${empty.calls.length}`);
  await empty.ctx.close();
}

// ---- a phone, and accessibility -----------------------------------------------------------------------------------------------
{
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Document/ }).click();
  await page.getByText("Employment Agreement", { exact: false }).first().click();
  await page.getByRole("button", { name: /^Analysis/ }).click();
  await page.getByRole("tab", { name: /^Citations/ }).click();
  await table(page).waitFor({ timeout: 20000 });
  await settle(page);
  const m = await page.evaluate(() => ({
    hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    small: [...document.querySelectorAll("button,select,input,summary,[role=tab]")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 36 || r.width < 36); }).map((e) => `${e.tagName}:${(e.getAttribute("aria-label") || e.innerText || "").trim().slice(0, 20)}`),
  }));
  check(m.hscroll <= 0, "phone: no sideways page scroll", `${m.hscroll}px`);
  check(m.small.length === 0, "phone: every control is at least 36px", m.small.join(", "));
  check((await table(page).getByText("Cites").count()) >= 1, "phone: the cross-reference in the employment agreement is listed");
  await page.evaluate(axeSource);
  const axe = await page.evaluate(async () => (await window.axe.run(document.body, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((v) => `${v.id}: ${v.nodes.length}`));
  check(axe.length === 0, "phone: the tab has no accessibility violations", axe.join(", "));
  check(errors.length === 0, "phone: no page errors", errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, page } = await open();
  await page.getByRole("tab", { name: /^Citations/ }).click();
  await page.getByText("Mutual Non-Disclosure Agreement", { exact: false }).first().click();
  await table(page).waitFor({ timeout: 20000 });
  await settle(page);
  await page.evaluate(axeSource);
  const axe = await page.evaluate(async () => (await window.axe.run(document.body, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((v) => `${v.id}: ${v.nodes.length}`));
  check(axe.length === 0, "desktop: the tab has no accessibility violations", axe.join(", "));
  const nda = await table(page).innerText();
  check(/Supported/.test(nda) && !/Missing/.test(nda) && !/Auto-renewal/.test(nda), "a balanced NDA reads as supported, with no missing terms and no auto-renewal check");
  await ctx.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} of ${checks} checks FAILED:\n - ${failures.join("\n - ")}` : `\nall ${checks} checks passed`);
process.exit(failures.length ? 1 : 0);
