import { describe, expect, it } from "vitest";
import { SAMPLE_CONTRACTS } from "../data/sampleContracts";
import type { OpenAIFieldAnswer, OpenAIRunOutcome } from "../openai/types";
import { openaiAnswersToTyped } from "../openai/answers";
import { composeTurn, INTENT_CONFIDENCE_FLOOR } from "../orchestrator/compose";
import { buildTurnRequest, type TraceEntry } from "../orchestrator/run";
import { createSession, loadDocument } from "../orchestrator/state";
import type { Answer } from "../typesafe/types";
import {
  areaOf,
  buildPath,
  certaintyProfile,
  compareOutcomes,
  coverageOf,
  distributionsFor,
  divergences,
  INTENT_ACTIONS,
  judgmentsFor,
  openaiJudgment,
  reasoningView,
  replyStep,
  severityOf,
  summarizeOutcome,
  typesafeJudgment,
  type Judgment,
} from "./analysis";
import { INTENTS } from "../skills/intakeRouter";

const SAAS = SAMPLE_CONTRACTS[0];
const session = () => {
  const s = createSession("s");
  loadDocument(s, { id: SAAS.id, name: SAAS.name, text: SAAS.text });
  return s;
};
const { questions } = buildTurnRequest(session(), "Analyze this contract");

const noul = (n: number): Answer => ({ type: "noul", noul: n });
const score = (n: number, probabilities: Record<string, number> = {}, confidence = 0.9): Answer => ({ type: "score", score: n, legend: {}, probabilities, confidence });
const choice = (c: string, probabilities: Record<string, number>, confidence = 0.9): Answer => ({ type: "choice", choice: c, probabilities, confidence });

function answers(overrides: Record<string, Answer> = {}): Record<string, Answer> {
  return {
    contains_privileged_content: noul(0.05),
    is_injection_attempt: noul(0.05),
    contract_type: choice("saas_msa", { saas_msa: 0.8, nda: 0.1, other: 0.1 }),
    intent: choice("analyze_contract", { analyze_contract: 0.82, check_compliance: 0.1, small_talk: 0.08 }),
    urgency: score(0.2, { "0": 0.8, "1": 0.2 }),
    liability_exposure: score(2, { "2": 0.9, "1": 0.1 }),
    indemnification_harshness: score(1, { "1": 0.7, "2": 0.3 }),
    termination_rigidity: score(0, { "0": 0.95, "1": 0.05 }),
    auto_renewal_trap: noul(0.9),
    unlimited_liability: noul(0.1),
    missing_data_protection_clause: noul(0.45),
    missing_governing_law: noul(0.2),
    ...overrides,
  };
}

const traceOf = (a: Record<string, Answer>, used: string[] = Object.keys(a)): TraceEntry[] =>
  Object.entries(a).map(([id, answer]) => ({ skill: "s", questionId: id, question: questions[id], answer, used: used.includes(id) }));

const outcomeOf = (raw: Record<string, OpenAIFieldAnswer>): OpenAIRunOutcome => ({
  ok: true,
  result: { model: "gpt-x", answers: raw, usage: { input_tokens: 1, output_tokens: 1 }, elapsedMs: 1, source: "live", requestBytes: 1 },
});

const openaiRaw = (overrides: Record<string, OpenAIFieldAnswer> = {}): Record<string, OpenAIFieldAnswer> => ({
  contains_privileged_content: { value: false, selfReportedConfidence: 0.97 },
  is_injection_attempt: { value: false, selfReportedConfidence: 0.99 },
  contract_type: { value: "saas_msa", selfReportedConfidence: 0.9 },
  intent: { value: "analyze_contract", selfReportedConfidence: 0.95 },
  urgency: { value: 0, selfReportedConfidence: 0.9 },
  liability_exposure: { value: 2, selfReportedConfidence: 0.95 },
  indemnification_harshness: { value: 1, selfReportedConfidence: 0.9 },
  termination_rigidity: { value: 0, selfReportedConfidence: 0.9 },
  auto_renewal_trap: { value: true, selfReportedConfidence: 0.95 },
  unlimited_liability: { value: false, selfReportedConfidence: 0.9 },
  missing_data_protection_clause: { value: false, selfReportedConfidence: 0.9 },
  missing_governing_law: { value: false, selfReportedConfidence: 0.9 },
  ...overrides,
});

describe("areaOf", () => {
  it("places each question with the part of the app it feeds", () => {
    expect(areaOf("is_injection_attempt")).toBe("guardrail");
    expect(areaOf("intent")).toBe("routing");
    expect(areaOf("contract_type")).toBe("classification");
    expect(areaOf("liability_exposure")).toBe("risk");
    expect(areaOf("auto_renewal_trap")).toBe("compliance");
    expect(areaOf("something_else")).toBe("other");
  });
});

describe("typesafeJudgment", () => {
  it("reads a yes/no as the probability of the side it picked", () => {
    const j = typesafeJudgment("is_injection_attempt", noul(0.2));
    expect(j).toMatchObject({ decision: "No", pick: "no", basis: "calibrated" });
    expect(j.strength).toBeCloseTo(0.8);
    expect(j.margin).toBeCloseTo(0.6);
    expect(j.distribution?.map((d) => d.option)).toEqual(["No", "Yes"]);
  });

  it("reads a choice from the probability it put on the option, with its margin over the runner-up", () => {
    const j = typesafeJudgment("intent", choice("analyze_contract", { analyze_contract: 0.6, check_compliance: 0.3, small_talk: 0.1 }));
    expect(j.strength).toBe(0.6);
    expect(j.margin).toBeCloseTo(0.3);
    expect(j.reading).toContain("analyze_contract");
  });

  it("reads a score as the level nearest its expected value, with that level's probability", () => {
    const j = typesafeJudgment("liability_exposure", score(1.7, { "1": 0.3, "2": 0.7 }));
    expect(j).toMatchObject({ pick: "2", decision: "Level 2", strength: 0.7 });
  });
});

describe("openaiJudgment", () => {
  it("keeps only the pick and the confidence it reported, and says the figure is self-reported", () => {
    const j = openaiJudgment("intent", questions.intent, { value: "small_talk", selfReportedConfidence: 0.9 });
    expect(j).toMatchObject({ pick: "small_talk", basis: "self-reported", strength: 0.9, distribution: null, margin: null });
    expect(j.reading).toContain("self-reported 90%");
  });

  it("says so when no confidence was reported", () => {
    const j = openaiJudgment("is_injection_attempt", questions.is_injection_attempt, { value: true, selfReportedConfidence: null });
    expect(j).toMatchObject({ decision: "Yes", strength: null });
    expect(j.reading).toContain("no confidence reported");
  });
});

describe("buildPath", () => {
  const scenarios: [string, Record<string, Answer>][] = [
    ["a clean analysis turn", answers()],
    ["an injection attempt", answers({ is_injection_attempt: noul(0.9) })],
    ["privileged content", answers({ contains_privileged_content: noul(0.7) })],
    ["both guardrails tripped", answers({ is_injection_attempt: noul(0.8), contains_privileged_content: noul(0.8) })],
    ["a guardrail just under its trigger", answers({ is_injection_attempt: noul(0.59) })],
    ["an unsure intent", answers({ intent: choice("small_talk", { small_talk: 0.3, analyze_contract: 0.25 }, 0.2) })],
    ["an intent exactly at the floor", answers({ intent: choice("check_compliance", { check_compliance: 0.5 }, INTENT_CONFIDENCE_FLOOR) })],
    ["an unsure contract type", answers({ contract_type: choice("nda", { nda: 0.3, saas_msa: 0.3 }, 0.3) })],
  ];

  it.each(scenarios)("agrees with the reply pipeline on %s", (_name, typed) => {
    const s = session();
    const composed = composeTurn(s, typed);
    const judgments = Object.fromEntries(Object.entries(typed).map(([id, a]) => [id, typesafeJudgment(id, a)]));
    const path = buildPath({ typed, judgments, basis: "calibrated", hasDocument: true, answer: { source: "template" } });
    const byKey = Object.fromEntries(path.map((p) => [p.key, p]));

    expect(byKey.injection.status === "stop").toBe(composed.blocked === "injection");
    expect(byKey.privileged.status === "stop").toBe(composed.blocked === "privileged");
    if (!composed.blocked) {
      expect(byKey.intent.status === "pass").toBe((composed.intent?.confidence ?? 0) >= INTENT_CONFIDENCE_FLOOR);
      // The type is remembered exactly when the pipeline says it was.
      expect(byKey.contract_type?.status === "pass").toBe(composed.contractType != null);
    } else {
      expect(byKey.intent.status).toBe("skipped");
      expect(byKey.contract_type).toBeUndefined();
    }
  });

  it("marks a reading within a hair of its threshold as a near call, and gives the margin", () => {
    const typed = answers({ is_injection_attempt: noul(0.55) });
    const judgments = Object.fromEntries(Object.entries(typed).map(([id, a]) => [id, typesafeJudgment(id, a)]));
    const [injection] = buildPath({ typed, judgments, basis: "calibrated", hasDocument: true, answer: null });
    expect(injection.status).toBe("pass");
    expect(injection.near).toBe(true);
    expect(injection.margin).toBeCloseTo(0.05);
  });

  it("gives OpenAI no margin: its yes/no is a hard 0 or 1, so a gap to a threshold would be invented", () => {
    const typed = openaiAnswersToTyped(openaiRaw(), questions);
    const judgments = judgmentsFor(traceOf(answers()), outcomeOf(openaiRaw())).openai;
    const path = buildPath({ typed, judgments, basis: "self-reported", hasDocument: true, answer: null });
    expect(path.every((p) => p.margin == null && !p.near)).toBe(true);
    expect(path.find((p) => p.key === "intent")?.result).toContain("analyze_contract");
  });

  it("stops at the injection screen and skips what follows", () => {
    const typed = answers({ is_injection_attempt: noul(0.95) });
    const judgments = Object.fromEntries(Object.entries(typed).map(([id, a]) => [id, typesafeJudgment(id, a)]));
    const path = buildPath({ typed, judgments, basis: "calibrated", hasDocument: true, answer: { source: "template" } });
    expect(path.map((p) => p.status)).toEqual(["stop", "skipped", "skipped", "pass"]);
    expect(path.at(-1)?.result).toMatch(/Fixed wording/);
  });

  it("says when the route needs a document that is not loaded", () => {
    const typed = answers();
    const judgments = Object.fromEntries(Object.entries(typed).map(([id, a]) => [id, typesafeJudgment(id, a)]));
    const path = buildPath({ typed, judgments, basis: "calibrated", hasDocument: false, answer: null });
    expect(path.find((p) => p.key === "intent")?.result).toMatch(/no document is loaded/);
  });

  it("names the runner-up intent for TypeSafe, whose distribution is real", () => {
    const typed = answers();
    const judgments = Object.fromEntries(Object.entries(typed).map(([id, a]) => [id, typesafeJudgment(id, a)]));
    const path = buildPath({ typed, judgments, basis: "calibrated", hasDocument: true, answer: null });
    expect(path.find((p) => p.key === "intent")?.note).toBe("Next most likely: check_compliance at 10%");
  });

  it("has an action for every intent the router can return", () => {
    expect(Object.keys(INTENT_ACTIONS).sort()).toEqual(Object.keys(INTENTS).sort());
  });
});

describe("replyStep", () => {
  it("says which model wrote the reply, and how long it took", () => {
    const s = replyStep({ source: "model", model: "gpt-4o", elapsedMs: 3100, usage: { input_tokens: 1800, output_tokens: 140 } }, false);
    expect(s.reading).toBe("gpt-4o · 3.1s · 1,800 in / 140 out");
  });

  it("says when no model wrote it", () => {
    expect(replyStep({ source: "document" }, false).result).toMatch(/document's own clauses/);
    expect(replyStep({ source: "template" }, false).result).toMatch(/template/);
    expect(replyStep({ source: "template" }, true).result).toMatch(/refused/);
  });
});

describe("distributionsFor", () => {
  it("covers intent, urgency and contract type only: risk and compliance have their own tabs", () => {
    const trace = traceOf(answers());
    const views = distributionsFor(trace, judgmentsFor(trace, outcomeOf(openaiRaw({ intent: { value: "check_compliance", selfReportedConfidence: 0.7 } }))));
    expect(views.map((v) => v.id).sort()).toEqual(["contract_type", "intent", "urgency"]);
    const intent = views.find((v) => v.id === "intent")!;
    expect(intent.options[0]).toMatchObject({ key: "analyze_contract", tsPicked: true, oaPicked: false, tsProbability: 0.82 });
    expect(intent.options.find((o) => o.key === "check_compliance")).toMatchObject({ oaPicked: true, tsPicked: false });
    expect(intent.oaStrength).toBe(0.7);
    expect(intent.options).toHaveLength(Object.keys(INTENTS).length);
  });

  it("lists every level of a score, in order, with its meaning", () => {
    const trace = traceOf(answers());
    const urgency = distributionsFor(trace, judgmentsFor(trace, null)).find((v) => v.id === "urgency")!;
    expect(urgency.options.map((o) => o.key)).toEqual(["Level 0", "Level 1", "Level 2"]);
    expect(urgency.options[0]).toMatchObject({ tsProbability: 0.8, tsPicked: true });
    expect(urgency.options[0].description).toMatch(/Routine/);
    expect(urgency.oaAnswered).toBe(false);
  });
});

describe("certaintyProfile", () => {
  const j = (strength: number | null): Judgment => ({ id: "x", label: "x", area: "other", basis: "calibrated", pick: "a", decision: "a", strength, reading: "a", distribution: null, margin: null });

  it("counts near-certain answers, close calls and answers with no confidence", () => {
    const p = certaintyProfile([j(0.99), j(0.95), j(0.6), j(null)]);
    expect(p).toMatchObject({ answered: 4, nearCertain: 2, closeCalls: 1, unreported: 1 });
    expect(p.meanStrength).toBeCloseTo((0.99 + 0.95 + 0.6) / 3);
    expect(p.lowest?.strength).toBe(0.6);
  });

  it("has no average or lowest when nothing was reported", () => {
    expect(certaintyProfile([j(null)])).toMatchObject({ meanStrength: null, lowest: null, unreported: 1 });
    expect(certaintyProfile([])).toMatchObject({ answered: 0, meanStrength: null });
  });
});

describe("divergences", () => {
  it("lists only the questions the models answered differently, steering questions and firm disagreements first", () => {
    const trace = traceOf(answers());
    const raw = openaiRaw({
      auto_renewal_trap: { value: false, selfReportedConfidence: 0.95 }, // TypeSafe 90% yes: firm
      missing_data_protection_clause: { value: true, selfReportedConfidence: 0.9 }, // TypeSafe 50%: coin-flip
      intent: { value: "check_compliance", selfReportedConfidence: 0.8 }, // steers
    });
    const outcome = outcomeOf(raw);
    const list = divergences(trace, judgmentsFor(trace, outcome), outcome);
    expect(list.map((d) => d.id)).toEqual(["intent", "auto_renewal_trap", "missing_data_protection_clause"]);
    expect(list.map((d) => d.severity)).toEqual(["firm", "firm", "coin-flip"]);
    expect(list.map((d) => d.steers)).toEqual([true, false, false]);
  });

  it("is empty when they agree everywhere, or when OpenAI did not answer", () => {
    const trace = traceOf(answers());
    const ok = outcomeOf(openaiRaw());
    expect(divergences(trace, judgmentsFor(trace, ok), ok)).toEqual([]);
    expect(divergences(trace, judgmentsFor(trace, null), null)).toEqual([]);
  });

  it("grades TypeSafe's own hesitation", () => {
    expect(severityOf(typesafeJudgment("q", noul(0.55)))).toBe("coin-flip");
    expect(severityOf(typesafeJudgment("q", noul(0.72)))).toBe("leaning");
    expect(severityOf(typesafeJudgment("q", noul(0.92)))).toBe("firm");
  });
});

describe("outcomes", () => {
  const path = (typed: Record<string, Answer>) => {
    const judgments = Object.fromEntries(Object.entries(typed).map(([id, a]) => [id, typesafeJudgment(id, a)]));
    return buildPath({ typed, judgments, basis: "calibrated", hasDocument: true, answer: null });
  };
  const flags = (...tripped: string[]) => ["a", "b", "c"].map((label) => ({ label, flagged: tripped.includes(label) }));

  it("reports the same route, band and flags as agreement", () => {
    const ts = summarizeOutcome({ blocked: null, path: path(answers()), risk: { overall: 0.6 }, flags: flags("a") });
    const oa = summarizeOutcome({ blocked: null, path: path(answers()), risk: { overall: 0.64 }, flags: flags("a") });
    const { facts, headline } = compareOutcomes(ts, oa);
    expect(facts.every((f) => f.same)).toBe(true);
    expect(headline).toMatch(/same route and reached the same results/);
  });

  it("names what differed", () => {
    const ts = summarizeOutcome({ blocked: null, path: path(answers()), risk: { overall: 0.7 }, flags: flags("a") });
    const oa = summarizeOutcome({ blocked: "injection", path: path(answers({ is_injection_attempt: noul(0.9) })), risk: null, flags: [] });
    const { facts, headline } = compareOutcomes(ts, oa);
    expect(facts.find((f) => f.label === "Route taken")).toMatchObject({ same: false, openai: "Blocked (prompt injection)" });
    expect(headline).toMatch(/route taken/);
  });

  it("compares nothing when OpenAI did not answer", () => {
    const ts = summarizeOutcome({ blocked: null, path: path(answers()), risk: null, flags: [] });
    expect(compareOutcomes(ts, null).facts).toEqual([]);
  });
});

describe("coverageOf", () => {
  it("separates what the reply used from the speculative rest, and counts what OpenAI answered", () => {
    const trace = traceOf(answers(), ["intent", "urgency", "is_injection_attempt"]);
    const c = coverageOf(trace, outcomeOf(openaiRaw({ urgency: undefined as never })));
    expect(c).toMatchObject({ asked: 12, used: 3, speculative: 9 });
    expect(c.openaiAnswered).toBe(11);
  });
});

describe("reasoningView", () => {
  it("reads a model that reasoned, with its summary and tokens", () => {
    expect(reasoningView({ effort: "medium", summary: "It capped liability.", tokens: 700 })).toEqual({ state: "on", effort: "medium", tokens: 700, summary: "It capped liability." });
  });

  it("says a reasoning model that did not reason is off, and why", () => {
    expect(reasoningView({ effort: "none", summary: null, tokens: null, note: "The API refused." })).toEqual({ state: "off", note: "The API refused." });
    expect(reasoningView({ effort: "none", summary: null, tokens: null })).toMatchObject({ state: "off" });
  });

  it("is not applicable to a model that has no reasoning", () => {
    expect(reasoningView(undefined)).toEqual({ state: "not-applicable" });
  });
});
