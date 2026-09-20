/**
 * End-to-end check of the Document panel's pages, through the real UI.
 *
 *   npm run dev            # in one terminal (or `npm run meridian`)
 *   npm run test:e2e:pages
 *
 * Needs Google Chrome and the app at E2E_URL (default http://localhost:3000). It needs no API keys. A long text file is
 * uploaded and checked for: being divided into equal sheets that each hold their text, with nothing lost or repeated;
 * Previous and Next landing on the right page and the "n / N" indicator agreeing with them, and with where the reader
 * has scrolled by hand; the pages re-flowing at another zoom or panel size with the reader kept at the same passage;
 * a newly loaded document starting at its first page; and the same on a phone.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const URL_ = process.env.E2E_URL ?? "http://localhost:3000";
const failures = [];
let checks = 0;
const check = (ok, label, detail = "") => {
  checks += 1;
  if (!ok) failures.push(`${label}${detail ? ": " + detail : ""}`);
};

const clause = (i) => `${i}. Clause ${i}. ` + `The parties agree to the obligations of section ${i}, which continue for as long as this Agreement is in force. `.repeat(3 + (i % 5));
const schedule = "Schedule item one\nSchedule item two\nSchedule item three\nSchedule item four\nSchedule item five";
const text = Array.from({ length: 40 }, (_, i) => clause(i + 1) + (i % 7 === 6 ? `\n\n${schedule}` : "")).join("\n\n") + "\n\nSIGNATURES\n\nSigned by both parties.\n";
const file = join(mkdtempSync(join(tmpdir(), "meridian-pages-")), "long-agreement.txt");
writeFileSync(file, text);
const squash = (s) => s.replace(/\s+/g, " ").trim();
/** Where each page starts in the source text. Pages are slices of it, in order, so each is found after the last. */
const offsets = (texts) => {
  let from = 0;
  return texts.map((t) => {
    const at = text.indexOf(t, from);
    from = at + t.length;
    return at;
  });
};

const browser = await chromium.launch(process.env.E2E_CHROME_PATH ? { executablePath: process.env.E2E_CHROME_PATH, headless: true } : { channel: "chrome", headless: true });

async function open(viewport) {
  const page = await (await browser.newContext({ viewport, hasTouch: viewport.width < 800 })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL_, { waitUntil: "networkidle" });
  if (viewport.width < 800) await page.getByRole("button", { name: /^Document/ }).click();
  return { page, errors };
}
async function upload(page) {
  await page.setInputFiles("input[type=file]", file);
  await page.getByRole("region", { name: "Document preview" }).getByRole("group").first().waitFor();
  await page.getByText(/^1 \/ \d+$/).waitFor();
  await page.waitForTimeout(500);
}
const state = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('[aria-label="Document preview"]');
    const rootTop = root.getBoundingClientRect().top;
    const sheets = [...root.querySelectorAll("pre")].map((p) => p.parentElement);
    const indicator = document.querySelector('[aria-label="Page navigation"] span')?.textContent.trim() ?? null;
    return {
      indicator,
      current: indicator ? Number(indicator.split("/")[0]) : null,
      total: indicator ? Number(indicator.split("/")[1]) : sheets.length,
      sheets: sheets.length,
      heights: [...new Set(sheets.map((s) => Math.round(s.getBoundingClientRect().height)))],
      overflowing: sheets.filter((s) => s.scrollHeight > s.clientHeight + 1).length,
      tops: sheets.map((s) => Math.round(s.getBoundingClientRect().top - rootTop)),
      texts: sheets.map((s) => s.querySelector("pre").textContent),
      footers: sheets.map((s) => s.querySelector("p")?.textContent.trim() ?? ""),
      scrollTop: Math.round(root.scrollTop),
      scrollMax: root.scrollHeight - root.clientHeight,
      viewH: root.clientHeight,
      prevDisabled: document.querySelector('[aria-label="Previous page"]')?.disabled ?? null,
      nextDisabled: document.querySelector('[aria-label="Next page"]')?.disabled ?? null,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
const settle = (page, ms = 800) => page.waitForTimeout(ms);
const zoomIn = async (page, n) => {
  for (let i = 0; i < n && !(await page.getByLabel("Zoom in").isDisabled()); i += 1) await page.getByLabel("Zoom in").click();
  await settle(page, 500);
};

// ---------- desktop ----------
{
  const { page, errors } = await open({ width: 1440, height: 900 });
  await upload(page);
  let s = await state(page);
  console.log(`desktop: ${s.total} pages at the default size`);

  check(s.total > 3, "a long document is divided into several pages", `${s.total}`);
  check(s.sheets === s.total, "the indicator's total is the number of sheets on screen", `${s.sheets} vs ${s.total}`);
  check(s.current === 1 && s.prevDisabled && !s.nextDisabled, "it opens on page 1 with Previous disabled");
  check(s.heights.length === 1, "every page is the same size", s.heights.join(","));
  check(s.overflowing === 0, "no page's text runs past its sheet");
  check(squash(s.texts.join(" ")) === squash(text), "the pages together are exactly the document: nothing lost, nothing repeated");
  check(s.footers.every((f, i) => f === `Page ${i + 1} of ${s.total}`), "each sheet is labelled with its own number");
  check(s.tops[0] >= 0 && s.tops[0] < 30 && s.scrollTop === 0, "page 1 sits at the top, with no scroll offset", `top ${s.tops[0]}, scrollTop ${s.scrollTop}`);

  // Next / Previous
  for (let want = 2; want <= 4; want += 1) {
    await page.getByLabel("Next page").click();
    await settle(page);
    s = await state(page);
    check(s.current === want, `Next goes to page ${want}`, s.indicator);
    check(Math.abs(s.tops[want - 1]) < 30, `...and page ${want} is at the top of the panel`, `${s.tops[want - 1]}px`);
  }
  await page.getByLabel("Previous page").click();
  await settle(page);
  s = await state(page);
  check(s.current === 3 && Math.abs(s.tops[2]) < 30, "Previous goes back one page", s.indicator);

  // Rapid clicks all count
  await page.getByLabel("Next page").click();
  await page.getByLabel("Next page").click();
  await settle(page, 1200);
  s = await state(page);
  check(s.current === 5 && Math.abs(s.tops[4]) < 30, "two quick Next clicks move two pages", s.indicator);

  // Scrolling by hand moves the indicator
  await page.evaluate((y) => { document.querySelector('[aria-label="Document preview"]').scrollTop = y; }, 0);
  await settle(page, 400);
  s = await state(page);
  check(s.current === 1 && s.prevDisabled, "scrolling back to the top shows page 1");
  const pageH = await page.evaluate(() => document.querySelector('[aria-label="Document preview"] pre').parentElement.getBoundingClientRect().height + 24);
  await page.evaluate((y) => { document.querySelector('[aria-label="Document preview"]').scrollTop = y; }, pageH * 6 + 40);
  await settle(page, 400);
  s = await state(page);
  check(s.current === 7, "scrolling by hand to the seventh page shows page 7", s.indicator);
  await page.evaluate(() => { const r = document.querySelector('[aria-label="Document preview"]'); r.scrollTop = r.scrollHeight; });
  await settle(page, 400);
  s = await state(page);
  check(s.current === s.total && s.nextDisabled && !s.prevDisabled, "scrolling to the end shows the last page with Next disabled", s.indicator);
  await page.getByLabel("Previous page").click();
  await settle(page);
  s = await state(page);
  check(s.current === s.total - 1 && Math.abs(s.tops[s.total - 2]) < 30, "Previous works from the last page", s.indicator);

  // Every page is reachable with Next, and the indicator never skips
  await page.evaluate(() => { document.querySelector('[aria-label="Document preview"]').scrollTop = 0; });
  await settle(page, 400);
  const seen = [1];
  for (let i = 0; i < 60; i += 1) {
    if (await page.getByLabel("Next page").isDisabled()) break;
    await page.getByLabel("Next page").click();
    await settle(page, 700);
    seen.push((await state(page)).current);
  }
  check(seen.every((n, i) => n === i + 1) && seen.at(-1) === s.total, "clicking Next from the start visits every page in order, up to the last", `${seen.length} pages`);

  // Zoom re-flows the pages and keeps the reader's place
  await page.evaluate(() => { document.querySelector('[aria-label="Document preview"]').scrollTop = 0; });
  await settle(page, 400);
  for (let i = 0; i < 3; i += 1) { await page.getByLabel("Next page").click(); await settle(page, 700); }
  const before = await state(page);
  const anchor = offsets(before.texts)[before.current - 1];
  const totalBefore = before.total;
  await zoomIn(page, 3);
  s = await state(page);
  check(s.total > totalBefore, "a larger font makes more pages", `${totalBefore} → ${s.total}`);
  check(s.heights.length === 1 && s.overflowing === 0, "at a larger font every page is still one size and holds its text", `${s.heights} overflow ${s.overflowing}`);
  check(squash(s.texts.join(" ")) === squash(text), "...and the pages still add up to the whole document");
  const starts = offsets(s.texts);
  const shown = starts[s.current - 1];
  const shownEnd = starts[s.current] ?? text.length;
  check(shown <= anchor && anchor < shownEnd, "zooming keeps the reader at the same passage: the page now shown holds where they were", `was at offset ${anchor} (page ${before.current}); now page ${s.current} covers ${shown}-${shownEnd}`);
  check(Math.abs(s.tops[s.current - 1]) < 30, "...with that page in view");
  await zoomIn(page, 8);
  s = await state(page);
  check(s.heights.length === 1 && s.overflowing === 0, "at the largest font pages are still whole sheets", `${s.heights} overflow ${s.overflowing}`);
  await page.screenshot({ path: "reports/pages-zoomed.png" });
  for (let i = 0; i < 12 && !(await page.getByLabel("Zoom out").isDisabled()); i += 1) await page.getByLabel("Zoom out").click();
  await settle(page, 600);
  s = await state(page);
  check(s.total < totalBefore, "the smallest font makes fewer pages", `${s.total}`);
  check(s.heights.length === 1 && s.overflowing === 0 && squash(s.texts.join(" ")) === squash(text), "...and is still whole");

  // Collapsing or expanding the panel changes the sheet's width (and the size): pages re-flow to it
  await page.getByRole("button", { name: /^(Expand|Collapse)$/ }).click();
  await settle(page, 900);
  const wide = await state(page);
  check(wide.heights.length === 1 && wide.overflowing === 0 && squash(wide.texts.join(" ")) === squash(text), "collapsing or expanding the panel keeps pages whole", `${wide.heights} overflow ${wide.overflowing}`);
  await page.getByLabel("Next page").click();
  await settle(page);
  check((await state(page)).current === Math.min(wide.current + 1, wide.total), "paging still works after the panel changes size");
  await page.screenshot({ path: "reports/pages-expanded.png" });

  // A different document starts at its first page
  await page.evaluate(() => { const r = document.querySelector('[aria-label="Document preview"]'); r.scrollTop = r.scrollHeight; });
  await settle(page, 400);
  await page.getByRole("button", { name: /Mutual Non-Disclosure/ }).click();
  await settle(page, 600);
  s = await state(page);
  check(s.scrollTop === 0, "loading another document starts at the top", `${s.scrollTop}`);
  check(s.indicator === null && s.sheets === 1, "a document that fits on a page shows no page controls");
  check(s.heights.length === 1 && s.overflowing === 0, "...and its one sheet holds it");
  await upload(page);
  s = await state(page);
  check(s.current === 1 && s.prevDisabled && s.scrollTop === 0, "uploading the long document again starts on page 1", `${s.indicator} at ${s.scrollTop}`);

  check(errors.length === 0, "no page errors on desktop", errors.join(" | "));
  await page.context().close();
}

// ---------- phone ----------
{
  const { page, errors } = await open({ width: 390, height: 844 });
  await upload(page);
  let s = await state(page);
  console.log(`phone: ${s.total} pages`);
  check(s.total > 3 && s.sheets === s.total, "on a phone the long document is divided into pages too", `${s.total}`);
  check(s.heights.length === 1 && s.overflowing === 0, "phone: every page is one size and holds its text", `${s.heights} overflow ${s.overflowing}`);
  check(squash(s.texts.join(" ")) === squash(text), "phone: the pages add up to the whole document");
  check(!s.pageOverflowX, "phone: the page does not scroll sideways");
  for (let want = 2; want <= 3; want += 1) {
    await page.getByLabel("Next page").click();
    await settle(page);
    s = await state(page);
    check(s.current === want && Math.abs(s.tops[want - 1]) < 30, `phone: Next goes to page ${want}`, `${s.indicator}, top ${s.tops[want - 1]}`);
  }
  await page.getByLabel("Previous page").click();
  await settle(page);
  s = await state(page);
  check(s.current === 2, "phone: Previous goes back", s.indicator);
  const box = await page.getByLabel("Next page").boundingBox();
  check(box && box.width >= 40 && box.height >= 40, "phone: the page buttons are at least 40px to tap", `${box?.width}x${box?.height}`);
  await page.getByLabel("Zoom in").click();
  await page.getByLabel("Zoom in").click();
  await settle(page, 600);
  s = await state(page);
  check(s.heights.length === 1 && s.overflowing === 0, "phone: pages stay whole after zooming", `${s.heights} overflow ${s.overflowing}`);
  await page.screenshot({ path: "reports/pages-phone.png" });
  check(errors.length === 0, "no page errors on the phone", errors.join(" | "));
  await page.context().close();
}

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} of ${checks} checks failed:`);
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log(`\nall ${checks} checks passed`);
