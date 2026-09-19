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
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  check(await page.evaluate(() => document.querySelector("[role=dialog]")?.contains(document.activeElement) ?? false), "settings dialog: Tab is trapped inside");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  check((await page.locator("[role=dialog]").count()) === 0, "settings dialog: Escape closes it");
  check(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "API key settings"), "settings dialog: focus returns to the button that opened it");
  await ctx.close();
}

await browser.close();
console.log(`${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.error("\nFAILED:\n - " + failures.join("\n - "));
  process.exit(1);
}
