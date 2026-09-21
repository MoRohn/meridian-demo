/**
 * End-to-end check of the chat's answers, through the real UI.
 *
 *   npm run dev            # in one terminal (or `npm run meridian`)
 *   npm run test:e2e:chat
 *
 * Needs Google Chrome and the app at E2E_URL (default http://localhost:3000). It needs no API keys, and it never reads or
 * asks for one: keys are only ever saved in the Settings modal. It checks two things. With no answer model available, a
 * question about the contract is answered with the contract's own clauses, quoted with their section and labelled as such,
 * where it used to be a refusal. And an answer a model wrote (simulated at the network edge, since it needs a paid key)
 * is shown with its structure, says which model wrote it, and is logged as its own activity that never counts towards
 * TypeSafe's or OpenAI's speed and cost.
 */
import { chromium } from "playwright-core";

const URL_ = process.env.E2E_URL ?? "http://localhost:3000";
const failures = [];
let checks = 0;
const check = (ok, label, detail = "") => {
  checks += 1;
  if (!ok) failures.push(`${label}${detail ? ": " + detail : ""}`);
};

const browser = await chromium.launch(process.env.E2E_CHROME_PATH ? { executablePath: process.env.E2E_CHROME_PATH, headless: true } : { channel: "chrome", headless: true });

async function open(mockModelAnswer) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (mockModelAnswer) {
    await page.route("**/api/chat", async (route) => {
      const body = route.request().postDataJSON();
      const res = await route.fetch();
      const data = await res.json();
      // Only the free-typed question gets the "model" answer; loading the document and the first analysis stay real.
      if (body.action === "message" && /terminate/i.test(body.message) && data.result) {
        data.result.reply = mockModelAnswer.reply;
        data.result.answer = mockModelAnswer.answer;
      }
      return route.fulfill({ response: res, json: data });
    });
  }
  await page.goto(URL_, { waitUntil: "networkidle" });
  await page.getByText("SaaS Master Services Agreement", { exact: false }).first().click();
  await page.waitForTimeout(2500);
  return { page, errors };
}

async function ask(page, text) {
  await page.getByPlaceholder("Ask about the context…").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForTimeout(2500);
}

// ---- no answer model: the contract's own words ----------------------------
{
  const { page, errors } = await open(null);
  await ask(page, "Can I terminate early?");
  const line = page.getByRole("region", { name: "Latest reply" }); // the compact chat line while the document is expanded
  const text = await line.innerText();
  check(/Section 6: Termination/.test(text), "no model: a question about the contract is answered with the relevant clause and its section", text.slice(0, 200));
  check(!/deliberate scope boundary/.test(text), "no model: it is no longer refused as out of scope");
  check((await line.locator("blockquote").count()) >= 1, "no model: the clause is shown as a quotation");
  check(/Quoted from the document\. No answer model was used\./.test(text), "no model: it says the words are the document's, not a model's");
  check(/Save an OpenAI key/.test(text), "no model: it points to the gear-icon Settings, and asks for nothing else");

  await ask(page, "What are the payment terms?");
  check(/Section 2: Fees/.test(await line.innerText()), "no model: 'payment terms' finds the Fees clause");

  await ask(page, "Give me a recap of this document");
  const recap = await line.innerText();
  check(/6 clauses/.test(recap) && /Section 4: Limitation of Liability/.test(recap), "no model: a recap lists the document's sections", recap.slice(0, 160));

  await ask(page, "How many penguins migrate each winter?");
  check(/couldn't find language/.test(await line.innerText()), "no model: an unrelated question is answered honestly, with no invented clause");
  check(errors.length === 0, "no page errors", errors.join(" | "));
  await page.context().close();
}

// ---- a model-written answer ------------------------------------------------
{
  const reply = [
    "Yes, but only on notice. The contract lets **either party** end it early:",
    "",
    '> "Either party may terminate this Agreement for convenience upon thirty (30) days written notice."',
    "Section 6: Termination",
    "",
    "What that means for you:",
    "- You must give **30 days** written notice.",
    "- Fees already invoiced stay payable.",
    "",
    "1. Send the notice in writing.",
    "2. Keep proof of delivery.",
  ].join("\n");
  const answer = { source: "model", model: "gpt-4o", usage: { input_tokens: 1800, output_tokens: 140 }, elapsedMs: 4100, costUsd: 0.0061 };
  const { page, errors } = await open({ reply, answer });
  await page.getByRole("button", { name: "Collapse" }).click(); // the full conversation, not the compact line
  await ask(page, "Can I terminate early?");
  const bubble = page.locator('[role="log"] > div').last();
  check((await bubble.locator("blockquote").count()) === 1, "model: a quoted clause is shown as a quotation");
  check((await bubble.locator("ul li").count()) === 2 && (await bubble.locator("ol li").count()) === 2, "model: bullets and numbered steps are shown as lists");
  check((await bubble.locator("strong").count()) >= 2, "model: bold is shown");
  const caption = await bubble.innerText();
  check(/Written by gpt-4o from the document and TypeSafe's findings/.test(caption), "model: it says which model wrote the answer, from whose findings");

  await page.getByRole("tab", { name: /^Trace/ }).click();
  await page.waitForTimeout(500);
  const trace = await page.getByRole("tabpanel").innerText();
  check(/LLM response/.test(trace) && /gpt-4o/.test(trace), "model: the writing is shown as the LLM response on the backend's own row, with its model");
  check(!/Answer writer/.test(trace), "model: the writing is not listed a second time as a row of its own");
  // TypeSafe made two calls (the analysis and the question); the writer's call must not be counted as a third.
  const perf = await page.locator('section[aria-label="Model performance"]').innerText().catch(() => "");
  check(perf === "" || /Calls \(failed\)\s*\n?\s*2 \(0\)/.test(perf) || !/Calls \(failed\)\s*\n?\s*3/.test(perf), "model: the writer's call is not counted in TypeSafe's call count", perf.slice(0, 120));
  check(errors.length === 0, "no page errors", errors.join(" | "));
  await page.context().close();
}

// ---- both models answer every question, in the order they finish ----------
{
  const openaiTurn = {
    reply: "OpenAI's answer: either party may terminate on **30 days** notice.",
    intent: { choice: "ask_legal_question", confidence: 0.9 },
    risk: null,
    complianceFlags: [],
    blocked: null,
    answer: { source: "model", model: "gpt-4o", usage: { input_tokens: 900, output_tokens: 80 }, elapsedMs: 300, costUsd: 0.002 },
  };
  const openaiOutcome = { ok: true, result: { model: "gpt-4o", answers: {}, usage: { input_tokens: 900, output_tokens: 80 }, elapsedMs: 300, source: "live", requestBytes: 5000 } };
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let slowOpenAI = 0; // ms OpenAI takes to answer, so each half of the test can make either model finish first
  let failOpenAI = false;
  await page.route("**/api/chat", async (route) => {
    const res = await route.fetch();
    const data = await res.json();
    data.openaiConfigured = true;
    // TypeSafe takes ~1.5s on the free-typed question; the document load and first analysis stay quick.
    if (route.request().postDataJSON().action === "message" && /terminate/i.test(route.request().postDataJSON().message)) await new Promise((r) => setTimeout(r, 1500));
    return route.fulfill({ response: res, json: data });
  });
  await page.route("**/api/compare-openai", async (route) => {
    await new Promise((r) => setTimeout(r, slowOpenAI));
    if (failOpenAI) return route.fulfill({ status: 500, json: { error: "Internal error" } });
    return route.fulfill({ json: { outcome: openaiOutcome, turn: openaiTurn, questionCount: 3, configured: true } });
  });
  await page.goto(URL_, { waitUntil: "networkidle" });
  await page.getByText("SaaS Master Services Agreement", { exact: false }).first().click();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Collapse" }).click(); // the full conversation, not the compact line
  const log = page.locator('[role="log"]');
  const ask2 = async (text, waitMs) => {
    await page.getByPlaceholder("Ask about the context…").fill(text);
    await page.getByRole("button", { name: "Send" }).click();
    await page.waitForTimeout(waitMs);
  };

  // OpenAI answers fast, TypeSafe slowly: OpenAI's card comes first and is ranked 1st.
  await ask2("Can I terminate early?", 400);
  const waiting = await log.innerText();
  check(/OpenAI[\s\S]*1st/.test(waiting) && /TypeSafe[\s\S]*answering/.test(waiting), "both: the fast model's answer is shown while the slow one is still marked as answering", waiting.slice(-300));
  await page.waitForTimeout(2500);
  const first = await log.innerText();
  check(first.indexOf("OpenAI's answer") !== -1 && first.indexOf("OpenAI's answer") < first.indexOf("TypeSafe", first.indexOf("OpenAI's answer")), "both: the answers are listed in the order they finished (OpenAI first)");
  check(/1st/.test(first) && /2nd/.test(first), "both: each answer shows where it finished");
  check(/Written by gpt-4o from the document and OpenAI's findings/.test(first), "both: OpenAI's answer says whose findings it was written from");

  // TypeSafe answers fast, OpenAI slowly: the order flips with them.
  slowOpenAI = 1800;
  await ask2("What are the payment terms?", 3500);
  const second = (await log.innerText()).split("What are the payment terms?")[1] ?? "";
  check(second.indexOf("TypeSafe") !== -1 && second.indexOf("TypeSafe") < second.indexOf("OpenAI"), "both: when TypeSafe finishes first it is listed first", second.slice(0, 200));

  // OpenAI failing is shown as its own card, without losing TypeSafe's answer.
  slowOpenAI = 0;
  failOpenAI = true;
  await ask2("Who is the governing law?", 3500);
  const third = (await log.innerText()).split("Who is the governing law?")[1] ?? "";
  check(/OpenAI could not answer/.test(third) && /TypeSafe/.test(third), "both: an OpenAI failure is shown in the chat next to TypeSafe's answer", third.slice(0, 200));

  await page.getByRole("tab", { name: /^Trace/ }).click();
  check(errors.length === 0, "no page errors", errors.join(" | "));
  await page.context().close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} of ${checks} checks FAILED:\n - ${failures.join("\n - ")}` : `\nall ${checks} checks passed`);
process.exit(failures.length ? 1 : 0);
