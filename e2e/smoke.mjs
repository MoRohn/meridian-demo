/**
 * UI smoke suite: layout, accessibility, keyboard and touch behavior across screen sizes, in a real browser.
 *
 *   npm run dev            # in one terminal (or `npm run meridian`)
 *   npm run test:e2e       # in another; exits non-zero on any failure
 *
 * Needs Google Chrome installed (uses playwright-core with the system Chrome; set E2E_CHROME_PATH to use another
 * binary) and the app running at E2E_URL (default http://localhost:3000). It needs no API keys and no eval service:
 * everything here is independent of any model or judge.
 */
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const URL_ = process.env.E2E_URL ?? "http://localhost:3000";
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const SIZES = { "phone 360": [360, 740], "phone 390": [390, 844], "tablet 768": [768, 1024], "laptop 1024": [1024, 768], "laptop 1366": [1366, 768], "desktop 1440": [1440, 900], "wide 1920": [1920, 1080], "phone landscape": [844, 390] };

const browser = await chromium.launch(process.env.E2E_CHROME_PATH ? { executablePath: process.env.E2E_CHROME_PATH, headless: true } : { channel: "chrome", headless: true });
const failures = [];
let checks = 0;
function check(ok, label, detail = "") {
  checks += 1;
  if (!ok) failures.push(`${label}${detail ? ": " + detail : ""}`);
}

for (const [name, [width, height]] of Object.entries(SIZES)) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 800 });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 160)));
  await page.goto(URL_, { waitUntil: "networkidle" });
  const mobile = width < 1024;
  if (mobile) await page.getByRole("button", { name: /^Document/ }).click();
  await page.getByText("SaaS Master Services Agreement", { exact: false }).first().click();
  await page.waitForTimeout(2200);

  // A chosen document opens at the compact 11px size everywhere; on desktop it also opens expanded, filling the left panel
  // (the control then offers "Collapse"). Phones and tablets have no expand control at all.
  const opened = await page.evaluate(() => {
    const text = document.querySelector('[style*="font-size"]');
    const toggle = [...document.querySelectorAll("button")].find((b) => ["Expand", "Collapse"].includes(b.textContent.trim()) && b.getBoundingClientRect().width > 0);
    return { fontSize: text ? getComputedStyle(text).fontSize : null, toggle: toggle ? toggle.textContent.trim() : null };
  });
  check(opened.fontSize === "11px", `${name}: a chosen document opens at 11px`, String(opened.fontSize));
  check(mobile ? opened.toggle === null : opened.toggle === "Collapse", `${name}: ${mobile ? "no expand control below the desktop breakpoint" : "a chosen document opens expanded"}`, String(opened.toggle));

  for (const view of mobile ? ["Document", "Assistant", "Analysis"] : [null]) {
    if (view) {
      await page.getByRole("button", { name: new RegExp("^" + view) }).click();
      await page.waitForTimeout(250);
    }
    const label = `${name}${view ? " / " + view : ""}`;
    const m = await page.evaluate(() => {
      const nav = document.querySelector("nav[aria-label='Workspace sections']");
      const small = mobileTargets();
      function mobileTargets() {
        return [...document.querySelectorAll("button,a,input,[role=tab],summary")]
          .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden" && (r.height < 36 || r.width < 36); })
          .map((e) => `${e.tagName}:${(e.getAttribute("aria-label") || e.innerText || "").trim().slice(0, 20)}`);
      }
      return { hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, nav: !!nav && getComputedStyle(nav).display !== "none", small };
    });
    check(m.hscroll <= 0, `${label}: no horizontal page scroll`, `${m.hscroll}px`);
    check(m.nav === mobile, `${label}: bottom nav ${mobile ? "shown" : "hidden"}`);
    if (width < 800) check(m.small.length === 0, `${label}: touch targets are at least 36px`, m.small.join(", "));
    // Everything must be reachable: scrolled to its end, no pane's content may sit below the visible area
    // (below the viewport, or below the bottom nav on small screens). Regression: the analysis panel used h-full next to the
    // Context window bar and ran that bar's height past the bottom, clipping the end of every tab.
    const reach = async (selector, what) => {
      const r = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el || el.getBoundingClientRect().height === 0) return null;
        el.scrollTop = el.scrollHeight;
        const nav = document.querySelector("nav[aria-label='Workspace sections']");
        const limit = Math.min(window.innerHeight, nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().top : Infinity);
        const paneBottom = el.getBoundingClientRect().bottom;
        const lowest = Math.max(...[...el.querySelectorAll("*")].map((e) => e.getBoundingClientRect()).filter((b) => b.height > 0).map((b) => b.bottom), 0);
        return { paneOver: Math.round(paneBottom - limit), contentOver: Math.round(lowest - limit) };
      }, selector);
      if (r) check(r.paneOver <= 1 && r.contentOver <= 1, `${label}: ${what} is fully reachable`, `pane ends ${r.paneOver}px and content ${r.contentOver}px past the visible area`);
    };
    if (!mobile || view === "Analysis") {
      for (const tab of ["Trace", "Risk", "Compliance", "Citations"]) {
        await page.getByRole("tab", { name: new RegExp(tab) }).click();
        await page.waitForTimeout(250);
        await reach("[role=tabpanel]", `${tab} tab`);
      }
      await page.getByRole("tab", { name: /Trace/ }).click();
      await page.waitForTimeout(450); // let the panel's fade-in finish: axe reads mid-fade text as low contrast
    }
    if (!mobile || view === "Document") await reach("[aria-label='Document preview']", "document preview");
    if (!mobile || view === "Assistant") {
      await reach("[role=log]", "chat history");
      const input = await page.evaluate(() => { const i = document.querySelector("form input"); const nav = document.querySelector("nav[aria-label='Workspace sections']"); const limit = Math.min(innerHeight, nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().top : Infinity); return i ? Math.round(i.getBoundingClientRect().bottom - limit) : null; });
      if (input !== null) check(input <= 1, `${label}: chat input is on screen`, `${input}px past the visible area`);
    }
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((v) => `${v.impact}:${v.id}`));
    check(violations.length === 0, `${label}: no accessibility violations`, violations.join(", "));
  }
  check(consoleErrors.length === 0, `${name}: no console or page errors`, consoleErrors.slice(0, 2).join(" | "));
  await ctx.close();
}

// Keyboard and dialog behavior (desktop).
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL_, { waitUntil: "networkidle" });
  const unfocusable = [];
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body || e.tagName.startsWith("NEXTJS")) return null; // Next's dev overlay is not app UI
      const cs = getComputedStyle(e);
      return { where: `${e.tagName}:${(e.getAttribute("aria-label") || e.innerText || "").trim().slice(0, 24)}`, ring: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none", named: !!(e.getAttribute("aria-label") || e.innerText || e.placeholder || e.title || "").trim() };
    });
    if (info && (!info.ring || !info.named)) unfocusable.push(info.where);
  }
  check(unfocusable.length === 0, "keyboard: every focus stop is named and shows a focus indicator", [...new Set(unfocusable)].join(", "));

  await page.getByRole("button", { name: /API key settings/ }).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  const dialog = await page.evaluate(() => { const d = document.querySelector("[role=dialog]"); return d && { modal: d.getAttribute("aria-modal") === "true", labelled: !!d.getAttribute("aria-labelledby"), focusInside: d.contains(document.activeElement) }; });
  check(!!dialog && dialog.modal && dialog.labelled && dialog.focusInside, "settings dialog: role, aria-modal, label, and focus moved inside", JSON.stringify(dialog));
  await page.evaluate(axeSource);
  const dialogViolations = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((v) => `${v.impact}:${v.id}`));
  check(dialogViolations.length === 0, "settings dialog: no accessibility violations (including the auto-evaluate checkbox)", dialogViolations.join(", "));
  check(await page.getByRole("checkbox", { name: /Evaluate the first result of each action automatically/ }).isChecked(), "settings dialog: auto-evaluate is on by default");
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  check(await page.evaluate(() => document.querySelector("[role=dialog]")?.contains(document.activeElement) ?? false), "settings dialog: Tab is trapped inside");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  check((await page.locator("[role=dialog]").count()) === 0, "settings dialog: Escape closes it");
  check(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "API key settings"), "settings dialog: focus returns to the button that opened it");
  await ctx.close();
}

// Brightness: the slider, persistence, and legibility (an axe scan) on every level across every view.
{
  const LEVELS = ["bright", "original", "default", "dark", "darkest"];
  const level = (page) => page.evaluate(() => document.documentElement.getAttribute("data-level"));
  const axeScan = async (page) => { await page.evaluate(axeSource); return page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((v) => `${v.impact}:${v.id}`)); };

  // -- operating the control
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL_, { waitUntil: "networkidle" });
  check((await level(page)) === null, "brightness: a first-time visitor gets the default palette (no override set)");
  const trigger = page.getByRole("button", { name: /Display brightness/ });
  check(/Default/.test((await trigger.getAttribute("aria-label")) ?? ""), "brightness: the button names the current level");
  await trigger.click();
  const slider = page.getByRole("slider", { name: "Brightness level" });
  check(await slider.isVisible(), "brightness: opening the control shows a slider");
  check(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Brightness level"), "brightness: focus moves to the slider");
  check((await slider.getAttribute("min")) === "0" && (await slider.getAttribute("max")) === "4", "brightness: the slider has exactly five stops");
  check((await slider.getAttribute("aria-valuetext"))?.startsWith("Default"), "brightness: the slider announces the level's name");
  await page.keyboard.press("ArrowRight");
  check((await level(page)) === "dark", "brightness: right arrow goes one level darker");
  await page.keyboard.press("End");
  check((await level(page)) === "darkest", "brightness: End goes to the darkest");
  await page.keyboard.press("Home");
  check((await level(page)) === "bright", "brightness: Home goes to the brightest");
  await page.getByRole("button", { name: "Original", exact: true }).click();
  check((await level(page)) === "original", "brightness: clicking a named stop selects it");
  check(await page.getByRole("button", { name: "Original", exact: true }).getAttribute("aria-pressed") === "true", "brightness: the chosen stop is marked pressed");
  await page.getByRole("button", { name: "Reset to default" }).click();
  check((await level(page)) === "default", "brightness: Reset to default returns to the default");
  check(await page.getByRole("button", { name: "Reset to default" }).count() === 0, "brightness: no reset link while already on the default");
  await page.keyboard.press("Escape");
  check((await page.getByRole("dialog", { name: "Display brightness" }).count()) === 0, "brightness: Escape closes the control");
  check(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Display brightness") ?? false), "brightness: focus returns to the button");

  // -- remembered, and applied before first paint
  await trigger.click();
  await page.getByRole("button", { name: "Darkest", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "domcontentloaded" });
  check((await level(page)) === "darkest", "brightness: the choice is already applied at DOMContentLoaded, before any content paints");
  await page.evaluate(() => localStorage.setItem("meridian.theme", "not-a-level"));
  await page.reload({ waitUntil: "networkidle" });
  check((await level(page)) === null, "brightness: a corrupt saved value falls back to the default instead of breaking the page");
  await ctx.close();

  // -- every level, every view: legible and accessible
  for (const lv of LEVELS) {
    for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
      const c = await browser.newContext({ viewport });
      const p = await c.newPage();
      await p.addInitScript((l) => localStorage.setItem("meridian.theme", l), lv);
      await p.goto(URL_, { waitUntil: "networkidle" });
      const phone = name === "phone";
      if (phone) await p.getByRole("button", { name: /^Document/ }).click();
      await p.getByText("SaaS Master Services Agreement", { exact: false }).first().click();
      await p.waitForTimeout(2200);
      const label = `${lv} / ${name}`;
      check((await level(p)) === lv, `${label}: the level is applied`);
      const views = phone ? ["Document", "Assistant", "Analysis"] : [null];
      for (const v of views) {
        if (v) { await p.getByRole("button", { name: new RegExp("^" + v) }).click(); await p.waitForTimeout(300); }
        const tabs = !v || v === "Analysis" ? ["Trace", "Risk", "Compliance", "Citations"] : [null];
        for (const tab of tabs) {
          if (tab) { await p.getByRole("tab", { name: new RegExp(tab) }).click(); await p.waitForTimeout(450); }
          const found = await axeScan(p);
          check(found.length === 0, `${label} / ${v ?? "all panes"}${tab ? " / " + tab : ""}: no accessibility violations`, found.join(", "));
        }
      }
      await p.getByRole("button", { name: /Display brightness/ }).click();
      await p.waitForTimeout(300);
      const pop = await axeScan(p);
      check(pop.length === 0, `${label}: the brightness control itself has no accessibility violations`, pop.join(", "));
      const fits = await p.evaluate(() => { const d = document.querySelector("[role=dialog]"); if (!d) return null; const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; });
      check(fits !== false, `${label}: the brightness popover stays inside the screen`);
      await p.keyboard.press("Escape");
      await p.getByRole("button", { name: /API key settings/ }).click();
      await p.waitForTimeout(300);
      const dlg = await axeScan(p);
      check(dlg.length === 0, `${label}: the settings dialog has no accessibility violations`, dlg.join(", "));
      await c.close();
    }
  }
}

// Citations: the loaded document is read and checked automatically. Nothing is typed in or clicked.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL_, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /Citations/ }).click();
  check((await page.getByText("Load or upload a document, and its citations and key terms are found and checked here automatically.").count()) === 1, "citations: with no document, the tab says what will happen");
  await page.getByText("SaaS Master Services Agreement", { exact: false }).first().click();
  const table = page.getByRole("table", { name: "Citation checks" });
  await table.waitFor({ timeout: 15000 }).catch(() => {});
  check((await table.count()) === 1, "citations: loading a document produces the checks table on its own, with no click");
  const rows = await table.locator("tbody tr").count();
  check(rows >= 8, "citations: it lists the group header and a row per key term found in the document", `${rows} rows`);
  for (const term of ["Liability cap", "Termination", "Indemnification", "Governing law"]) check((await table.getByText(term, { exact: true }).count()) >= 1, `citations: the ${term} check is in the table`);
  check((await table.getByText("Missing").count()) >= 1, "citations: an essential term the document lacks (governing law) is reported missing");
  await page.waitForFunction(() => /Contradicted/.test(document.querySelector('table[aria-label="Citation checks"]')?.textContent ?? ""), null, { timeout: 15000 }).catch(() => {});
  check((await table.getByText("Contradicted").count()) >= 1, "citations: the model's verdicts arrive in the table, in the same words as everywhere");
  check((await page.getByText("supported:").count()) + (await page.getByText("contradicted:").count()) >= 1, "citations: the summary bar counts the results");
  for (const gone of ["Claim being made", "Quoted text supposedly backing it up", "Verify citation", "Playbook examples", "Suggested from your document"]) {
    check((await page.getByText(gone).count()) === 0 && (await page.getByPlaceholder(gone).count()) === 0, `citations: the old "${gone}" input is gone`);
  }
  check((await page.locator("textarea").count()) === 0, "citations: there is nothing to type into");
  await ctx.close();
}

await browser.close();
console.log(`${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.error("\nFAILED:\n - " + failures.join("\n - "));
  process.exit(1);
}
