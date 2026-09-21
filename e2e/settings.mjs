/**
 * End-to-end check of the API Keys modal (the gear icon), in particular its Judge model section.
 *
 *   npm run dev            # in one terminal (or `npm run meridian`)
 *   npm run test:e2e:settings
 *
 * Needs Google Chrome and the app at E2E_URL (default http://localhost:3000). It needs no real keys: it types obvious
 * placeholders into the modal, the way a reader would, and checks what is saved. Keys are only ever entered here.
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

const browser = await chromium.launch(process.env.E2E_CHROME_PATH ? { executablePath: process.env.E2E_CHROME_PATH, headless: true } : { channel: "chrome", headless: true });
// Keys are kept for the tab (sessionStorage) unless "Remember" is on, so what was saved is the two together.
const saved = (page) =>
  page.evaluate(() => {
    const local = JSON.parse(localStorage.getItem("meridian.apiKeys") ?? "null");
    return local ? { ...local, ...JSON.parse(sessionStorage.getItem("meridian.apiKeys.session") ?? "{}") } : null;
  });

for (const [name, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 800 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL_, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "API key settings" }).click();
  const modal = page.getByRole("dialog");
  const group = modal.getByRole("radiogroup", { name: "Judge model" });

  // ---- the default -----------------------------------------------------------
  check(await group.isVisible(), `${name}: the modal has a Judge model section`);
  const radios = await group.getByRole("radio").evaluateAll((els) => els.map((e) => ({ value: e.value, checked: e.checked })));
  check(radios.map((r) => r.value).join() === "saved,anthropic,gemini,openai", `${name}: the choices are: existing OpenAI key, Claude, Gemini, another OpenAI model`, radios.map((r) => r.value).join());
  check(radios.find((r) => r.checked)?.value === "saved", `${name}: the default is "Use my OpenAI key"`);
  const text = await modal.innerText();
  check(/Use my OpenAI key/.test(text) && /default/i.test(text), `${name}: the default is labelled`);
  check(/Recommended: judge with Claude or Gemini/.test(text), `${name}: it recommends a third-party judge, and says why`);
  check((await modal.getByText("Recommended", { exact: true }).count()) === 2, `${name}: Claude and Gemini are tagged Recommended`);
  check((await modal.getByLabel(/judge API key/i).count()) === 0, `${name}: no extra key field while the default is chosen`);
  check(/Save an OpenAI key above/.test(text), `${name}: with no OpenAI key yet, the default says what makes it ready`);
  await modal.getByLabel("OpenAI API key", { exact: true }).fill("sk-placeholder-openai-000000000000");
  check(!/Save an OpenAI key above/.test(await modal.innerText()), `${name}: once an OpenAI key is entered above, the default is ready`);

  // ---- Claude ---------------------------------------------------------------
  await group.getByRole("radio", { name: /Claude/ }).check();
  const claudeModel = modal.getByLabel("Claude judge model");
  check((await claudeModel.inputValue()) === "claude-sonnet-5", `${name}: choosing Claude selects its recommended model`);
  const claudeModels = await claudeModel.locator("option").allInnerTexts();
  check(claudeModels.length >= 4 && /Sonnet/.test(claudeModels[0]) && /Another model id/.test(claudeModels.at(-1)), `${name}: Claude's models are listed, with a way to type another`, claudeModels.join(" | "));
  await modal.getByLabel("Claude judge API key").fill("sk-ant-placeholder-claude-0000000");
  await claudeModel.selectOption("claude-haiku-4-5-20251001");

  // Looking at another provider shows that provider's own (empty) key field, and coming back finds the first key still there.
  await group.getByRole("radio", { name: /Gemini/ }).check();
  check((await modal.getByLabel("Gemini judge API key").inputValue()) === "", `${name}: a Claude key is not carried over to Gemini`);
  check((await modal.getByLabel("Gemini judge model").inputValue()) === "gemini-2.5-flash", `${name}: Gemini starts on its recommended model`);
  await group.getByRole("radio", { name: /Claude/ }).check();
  check((await modal.getByLabel("Claude judge API key").inputValue()) === "sk-ant-placeholder-claude-0000000", `${name}: clicking around does not lose a typed key`);
  check((await claudeModel.inputValue()) === "claude-sonnet-5", `${name}: ...and the model returns to that provider's default`);
  await claudeModel.selectOption("claude-haiku-4-5-20251001");

  // A model id that could not be one is refused.
  await claudeModel.selectOption("__custom__");
  await modal.getByLabel("Judge model id").fill("gpt 4o; drop");
  check(await modal.getByRole("alert").isVisible(), `${name}: a model id with spaces or symbols is flagged`);
  check(await modal.getByRole("button", { name: "Save" }).isDisabled(), `${name}: ...and cannot be saved`);
  await modal.getByLabel("Judge model id").fill("claude-sonnet-5");
  check(await modal.getByRole("button", { name: "Save" }).isEnabled(), `${name}: a valid id can`);

  // ---- accessibility and reach -------------------------------------------------
  await page.evaluate(axeSource);
  const axe = await page.evaluate(async () => (await window.axe.run(document.querySelector("[role=dialog]"), { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((v) => `${v.id}: ${v.nodes.length}`));
  check(axe.length === 0, `${name}: the modal has no accessibility violations`, axe.join(", "));
  const geometry = await page.evaluate(() => {
    const dlg = document.querySelector("[role=dialog]");
    const r = dlg.getBoundingClientRect();
    const targets = [...dlg.querySelectorAll("button,input,select,label")].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && (b.height < 36 || b.width < 36) && !(e.tagName === "INPUT" && (e.type === "radio" || e.type === "checkbox")); }).map((e) => `${e.tagName}:${(e.getAttribute("aria-label") || e.innerText || "").trim().slice(0, 24)}`);
    return { fitsWidth: r.left >= 0 && r.right <= window.innerWidth, fitsHeight: r.bottom <= window.innerHeight + 1, hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, targets };
  });
  check(geometry.fitsWidth && geometry.fitsHeight, `${name}: the modal fits the screen`);
  check(geometry.hscroll <= 0, `${name}: no sideways scroll`, `${geometry.hscroll}px`);
  if (width < 800) check(geometry.targets.length === 0, `${name}: touch targets are at least 36px`, geometry.targets.join(", "));
  await page.screenshot({ path: `reports/settings-${name}.png` });

  // ---- what is saved ----------------------------------------------------------
  await modal.getByRole("button", { name: "Save" }).click();
  const stored = await saved(page);
  check(stored?.judgeProvider === "anthropic" && stored?.judgeModel === "claude-sonnet-5", `${name}: the choice is saved`, JSON.stringify({ p: stored?.judgeProvider, m: stored?.judgeModel }));
  check(stored?.judgeApiKey === "sk-ant-placeholder-claude-0000000" && stored?.openaiApiKey === "sk-placeholder-openai-000000000000", `${name}: each key is saved in its own field`);

  // ---- reopening shows what was saved; the default can be returned to ----------
  await page.getByRole("button", { name: "API key settings" }).click();
  check(await modal.getByRole("radio", { name: /Claude/ }).isChecked(), `${name}: reopening shows Claude still chosen`);
  check((await modal.getByLabel("Claude judge API key").inputValue()) === "sk-ant-placeholder-claude-0000000", `${name}: ...with its key`);
  await group.getByRole("radio", { name: /Use my OpenAI key/ }).check();
  await modal.getByRole("button", { name: "Save" }).click();
  const back = await saved(page);
  check(back?.judgeProvider === "saved" && back?.judgeApiKey === "" && back?.judgeModel === "", `${name}: going back to the default leaves no stray judge key or model`, JSON.stringify({ p: back?.judgeProvider, k: back?.judgeApiKey, m: back?.judgeModel }));
  check(errors.length === 0, `${name}: no page errors`, errors.join(" | "));
  await ctx.close();
}

// Settings saved before the judge options existed still load, on the default.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("meridian.apiKeys", JSON.stringify({ typesafeApiKey: "", typesafeModel: "jev-latest", openaiApiKey: "sk-old-saved-0000000000000000", openaiModel: "gpt-4o", autoEvaluate: true })));
  await page.goto(URL_, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "API key settings" }).click();
  check(await page.getByRole("radio", { name: /Use my OpenAI key/ }).isChecked(), "older saved settings open on the default judge");
  check((await page.getByLabel("OpenAI API key", { exact: true }).inputValue()) === "sk-old-saved-0000000000000000", "...and keep their OpenAI key");
  await ctx.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} of ${checks} checks FAILED:\n - ${failures.join("\n - ")}` : `\nall ${checks} checks passed`);
process.exit(failures.length ? 1 : 0);
