/**
 * End-to-end check of the "Scoring Rubric" button and modal, on every analysis page.
 *
 *   npm run dev            # in one terminal (or `npm run meridian`)
 *   npm run test:e2e:rubrics
 *
 * Needs Google Chrome and the app at E2E_URL (default http://localhost:3000). It needs no keys and no evaluation service: the
 * rubrics endpoint is answered at the network edge with a fixed payload, and once with "service not running". It checks that
 * each page has the same button, that a page opens its own rubric (Trace opens all of them), that the modal shows each step as a
 * short label and summary (the exact wording behind a click), pass/fail score bands, and Meridian's own rules for that page
 * (risk dimensions, compliance checks, citation identifying, guardrails), that it scrolls, opens and closes by keyboard, and
 * passes the accessibility scan.
 */
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const URL_ = process.env.E2E_URL ?? "http://localhost:3000";
const failures = [];
let checks = 0;
const check = (ok, label, detail = "") => {
  checks += 1;
  if (!ok) failures.push(`${label}${detail ? ": " + detail : ""}`);
};

const step = (n) => `Step ${n} of the fixed rules, long enough to wrap onto more than one line in a narrow window so the modal has to scroll. `.repeat(3);
const rubric = (id, title, version) => ({
  id, version, title, task_line: `Judge the ${title.toLowerCase()}.`, pass_threshold: 0.6,
  steps: [1, 2, 3, 4, 5, 6].map((n) => `${id}-${step(n)}`),
  outline: [1, 2, 3, 4, 5, 6].map((n) => ({ label: `${id} label ${n}`, summary: `${id} short summary ${n}` })),
  bands: [{ low: 0, high: 3, outcome: `${id} failing band` }, { low: 4, high: 5, outcome: `${id} weak band` }, { low: 6, high: 8, outcome: `${id} passing band` }, { low: 9, high: 10, outcome: `${id} best band` }],
});
const PAYLOAD = {
  rubrics: { risk: rubric("risk", "Contract risk score", "1.2"), compliance: rubric("compliance", "Compliance flags", "1.2"), citation: rubric("citation", "Citation verdict", "1.1"), reply: rubric("reply", "Assistant reply", "1.1") },
};
// The route parses the service's payload; the browser receives the parsed shape, so give it that.
const parsed = Object.values(PAYLOAD.rubrics).map((r) => ({ id: r.id, version: r.version, title: r.title, taskLine: r.task_line, steps: r.steps, outline: r.outline, bands: r.bands, passThreshold: r.pass_threshold }));

const browser = await chromium.launch(process.env.E2E_CHROME_PATH ? { executablePath: process.env.E2E_CHROME_PATH, headless: true } : { channel: "chrome", headless: true });

async function open(width, height, rubrics) {
  const page = await (await browser.newContext({ viewport: { width, height }, hasTouch: width < 800 })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/rubrics", (route) => route.fulfill({ json: { rubrics } }));
  await page.goto(URL_, { waitUntil: "networkidle" });
  if (width < 800) await page.getByRole("button", { name: /Analysis/ }).click();
  return { page, errors };
}

const TABS = [["Trace", ["Contract risk score", "Compliance flags", "Citation verdict", "Assistant reply"]], ["Risk", ["Contract risk score"]], ["Compliance", ["Compliance flags"]], ["Citations", ["Citation verdict"]]];
// What "How Meridian decides" shows on each page: its guides, and a rule from each that must be there.
const RULES = {
  Trace: [["Risk score", "Liability exposure"], ["Compliance checks", "Auto-renewal without adequate notice"], ["Citation identifying", "Cross-references"], ["Guardrails", "Prompt-injection attempt"]],
  Risk: [["Risk score", "Termination rigidity"]],
  Compliance: [["Compliance checks", "No governing law / jurisdiction clause"], ["Guardrails", "Privileged or confidential content"]],
  Citations: [["Citation identifying", "Key terms"]],
};

for (const [name, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]]) {
  const { page, errors } = await open(width, height, parsed);
  for (const [tab, titles] of TABS) {
    await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
    const buttons = page.getByRole("button", { name: "Scoring Rubric", exact: true });
    check((await buttons.count()) === 1, `${name} / ${tab}: exactly one Scoring Rubric button`, String(await buttons.count()));
    await buttons.click();
    const dialog = page.getByRole("dialog", { name: /Scoring Rubric/ });
    await dialog.waitFor();
    const headings = await dialog.locator("h3").allInnerTexts();
    check(JSON.stringify(headings) === JSON.stringify(titles), `${name} / ${tab}: shows ${titles.length === 1 ? "its own rubric" : "all four rubrics"}`, headings.join(", "));
    const text = await dialog.innerText();
    check(/Scoring steps/i.test(text) && /Score bands/i.test(text) && /Pass at 6\/10 \(60%\)/.test(text), `${name} / ${tab}: shows steps, score bands and the pass mark`);
    check(/v1\.[12]/.test(text), `${name} / ${tab}: shows the rubric version`);
    const kind = { "Contract risk score": "risk", "Compliance flags": "compliance", "Citation verdict": "citation", "Assistant reply": "reply" };
    const summarized = titles.every((t) => [1, 2, 3, 4, 5, 6].every((n) => text.includes(`${kind[t]} label ${n}`) && text.includes(`${kind[t]} short summary ${n}`)));
    check(summarized, `${name} / ${tab}: every step is shown as a short label and summary`);
    check((await dialog.locator("details[open]").count()) === 0 && (await dialog.locator("details").count()) === titles.length, `${name} / ${tab}: the exact wording is one click away, closed by default`);
    const firstDetails = dialog.locator("details").first();
    await firstDetails.locator("summary").click();
    check((await firstDetails.locator("li").first().isVisible()) && /Step 1 of the fixed rules/.test(await firstDetails.innerText()), `${name} / ${tab}: opening it shows the judge's exact wording`);
    await firstDetails.locator("summary").click();
    const body = dialog.getByRole("region", { name: "Scoring rubric rules" });
    const scrolls = await body.evaluate((el) => el.scrollHeight > el.clientHeight + 20);
    check(scrolls, `${name} / ${tab}: the modal body scrolls`);
    const box = await dialog.boundingBox();
    check(box && box.height <= height && box.width <= width, `${name} / ${tab}: the modal fits the window`, JSON.stringify(box));
    if (titles.length > 1) {
      await dialog.getByRole("button", { name: "Assistant reply" }).click();
      await page.waitForTimeout(700);
      const top = await body.evaluate((el) => el.scrollTop);
      check(top > 100, `${name} / ${tab}: the jump chips scroll to a rubric`, String(top));
    }
    // Meridian's own rules for this page.
    await dialog.getByRole("tab", { name: "How Meridian decides" }).click();
    const rules = await dialog.innerText();
    const guideTitles = await dialog.locator("h3").allInnerTexts();
    check(JSON.stringify(guideTitles) === JSON.stringify(RULES[tab].map(([g]) => g)), `${name} / ${tab}: Meridian's rules show ${RULES[tab].map(([g]) => g).join(", ")}`, guideTitles.join(", "));
    check(RULES[tab].every(([, rule]) => rules.includes(rule)), `${name} / ${tab}: the rules include ${RULES[tab].map(([, r]) => r).join(", ")}`);
    if (tab === "Risk") check(/Weight 50%/.test(rules) && /Weight 30%/.test(rules) && /Weight 20%/.test(rules) && /0% \(low risk\)/.test(rules), `${name} / Risk: the dimensions show their weights and scale levels`);
    if (tab === "Compliance") check(/Flag at 55%/.test(rules) && /Blocks at 60%/.test(rules), `${name} / Compliance: the thresholds are shown`);
    if (tab === "Trace") {
      await page.waitForTimeout(500); // let the tab's colour transition finish: axe reads a mid-fade colour as low contrast
      await page.evaluate(axeSource);
      const rulesAxe = await page.evaluate(async () => (await window.axe.run(document.querySelector('[role="dialog"]'), { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((v) => `${v.impact}:${v.id}`));
      check(rulesAxe.length === 0, `${name}: the rules view has no accessibility violations`, rulesAxe.join(", "));
      await dialog.getByRole("tab", { name: "How answers are scored" }).click();
      await page.waitForTimeout(500);
      await page.evaluate(axeSource);
      const res = await page.evaluate(async () => (await window.axe.run(document.querySelector('[role="dialog"]'), { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((v) => `${v.impact}:${v.id}`));
      check(res.length === 0, `${name}: the modal has no accessibility violations`, res.join(", "));
    }
    await page.keyboard.press("Escape");
    check((await page.getByRole("dialog").count()) === 0, `${name} / ${tab}: Escape closes it`);
    check(await buttons.evaluate((el) => el === document.activeElement), `${name} / ${tab}: focus returns to the button`);
  }
  // Keyboard: the button opens with Enter, and Tab stays inside the modal.
  await page.getByRole("tab", { name: /^Risk/ }).click();
  await page.getByRole("button", { name: "Scoring Rubric", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press("Tab");
  check(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), `${name}: Tab stays inside the modal`);
  await page.getByRole("button", { name: "Close" }).click();
  check(errors.length === 0, `${name}: no page errors`, errors.join(" | "));
  await page.context().close();
}

// The evaluation service is not running: say so, with the fix, instead of an empty modal.
{
  const { page, errors } = await open(1440, 900, null);
  await page.getByRole("tab", { name: /^Risk/ }).click();
  await page.getByRole("button", { name: "Scoring Rubric", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Scoring Rubric/ });
  await dialog.waitFor();
  await page.waitForTimeout(300);
  const text = await dialog.innerText();
  check(/can.t be shown right now/.test(text) && /npm run eval-service/.test(text), "service off: says the rubric can't be shown and how to start the service");
  check(/Try again/.test(text) && /Risk score evaluation/.test(text), "service off: offers to retry and still describes the evaluation");
  await dialog.getByRole("tab", { name: "How Meridian decides" }).click();
  check(/Liability exposure/.test(await dialog.innerText()), "service off: Meridian's own rules are still shown");
  check(errors.length === 0, "service off: no page errors", errors.join(" | "));
  await page.context().close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} of ${checks} checks FAILED:\n - ${failures.join("\n - ")}` : `\nall ${checks} checks passed`);
process.exit(failures.length ? 1 : 0);
