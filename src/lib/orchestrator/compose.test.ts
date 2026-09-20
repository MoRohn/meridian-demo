import { describe, expect, it } from "vitest";
import { SAMPLE_CONTRACTS } from "../data/sampleContracts";
import { openaiAnswersToTyped } from "../openai/answers";
import type { OpenAIFieldAnswer } from "../openai/types";
import type { Answer } from "../typesafe/types";
import { composeTurn } from "./compose";
import { buildTurnRequest } from "./run";
import { createSession, loadDocument, type SessionState } from "./state";

const SAAS = SAMPLE_CONTRACTS[0];
const withDoc = (): SessionState => {
  const s = createSession("s");
  loadDocument(s, { id: SAAS.id, name: SAAS.name, text: SAAS.text });
  return s;
};

const noul = (n: number): Answer => ({ type: "noul", noul: n });
const score = (n: number, confidence = 0.9): Answer => ({ type: "score", score: n, legend: {}, probabilities: {}, confidence });
const choice = (c: string, confidence = 0.9): Answer => ({ type: "choice", choice: c, probabilities: { [c]: confidence }, confidence });

/** TypeSafe-style typed answers for an "analyze this contract" turn where every risk level is the top one and every check trips. */
function analyzeAnswers(overrides: Record<string, Answer> = {}): Record<string, Answer> {
  return {
    contains_privileged_content: noul(0.05),
    is_injection_attempt: noul(0.05),
    contract_type: choice("saas_subscription"),
    intent: choice("analyze_contract"),
    urgency: score(0),
    liability_exposure: score(2), indemnification_harshness: score(2), termination_rigidity: score(2),
    auto_renewal_trap: noul(0.9), unlimited_liability: noul(0.9), missing_data_protection_clause: noul(0.9), missing_governing_law: noul(0.9),
    ...overrides,
  };
}

/** The OpenAI-shaped equivalent of the same judgments (levels and booleans, with a self-reported confidence). */
function openaiEquivalent(message: string, overrides: Record<string, OpenAIFieldAnswer> = {}) {
  const { questions } = buildTurnRequest(withDoc(), message);
  const raw: Record<string, OpenAIFieldAnswer> = {
    contains_privileged_content: { value: false, selfReportedConfidence: 0.9 },
    is_injection_attempt: { value: false, selfReportedConfidence: 0.9 },
    contract_type: { value: "saas_subscription", selfReportedConfidence: 0.9 },
    intent: { value: "analyze_contract", selfReportedConfidence: 0.9 },
    urgency: { value: 0, selfReportedConfidence: 0.9 },
    liability_exposure: { value: 2, selfReportedConfidence: 0.9 }, indemnification_harshness: { value: 2, selfReportedConfidence: 0.9 }, termination_rigidity: { value: 2, selfReportedConfidence: 0.9 },
    auto_renewal_trap: { value: true, selfReportedConfidence: 0.9 }, unlimited_liability: { value: true, selfReportedConfidence: 0.9 }, missing_data_protection_clause: { value: true, selfReportedConfidence: 0.9 }, missing_governing_law: { value: true, selfReportedConfidence: 0.9 },
    ...overrides,
  };
  return openaiAnswersToTyped(raw, questions);
}

describe("openaiAnswersToTyped", () => {
  it("turns each kind of OpenAI answer into the typed shape, with no invented probability", () => {
    const typed = openaiEquivalent("Analyze this contract");
    expect(typed.auto_renewal_trap).toEqual({ type: "noul", noul: 1 });
    expect(typed.is_injection_attempt).toEqual({ type: "noul", noul: 0 });
    expect(typed.liability_exposure).toMatchObject({ type: "score", score: 2, confidence: 0.9, probabilities: { "2": 1 } });
    expect(typed.intent).toMatchObject({ type: "choice", choice: "analyze_contract", probabilities: { analyze_contract: 1 }, confidence: 0.9 });
  });
  it("uses a neutral confidence when OpenAI reported none, and skips questions it did not answer", () => {
    const typed = openaiEquivalent("Analyze this contract", { intent: { value: "analyze_contract", selfReportedConfidence: null } });
    expect((typed.intent as { confidence: number }).confidence).toBe(0.5);
    const { questions } = buildTurnRequest(withDoc(), "Analyze this contract");
    expect(openaiAnswersToTyped({}, questions)).toEqual({});
  });
  it("ignores a non-numeric score rather than inventing one", () => {
    const typed = openaiEquivalent("Analyze this contract", { liability_exposure: { value: "high", selfReportedConfidence: 0.9 } });
    expect(typed.liability_exposure).toBeUndefined();
  });
});

describe("composeTurn: one pipeline for both backends", () => {
  it("composes the SAME analysis reply from TypeSafe-style and OpenAI-style answers that say the same thing", () => {
    const ts = composeTurn(withDoc(), analyzeAnswers());
    const oa = composeTurn(withDoc(), openaiEquivalent("Analyze this contract"), { citeFlagProbability: false });
    expect(oa.reply).toBe(ts.reply);
    expect(ts.reply).toContain("**100% overall risk** (high)");
    expect(oa.risk?.overall).toBe(ts.risk?.overall);
    expect(oa.complianceFlags.map((f) => [f.id, f.flagged])).toEqual(ts.complianceFlags.map((f) => [f.id, f.flagged]));
  });

  it("quotes a flag's probability only when the backend has one to quote", () => {
    const ts = analyzeAnswers({ intent: choice("check_compliance") });
    const typesafe = composeTurn(withDoc(), ts).reply;
    const openai = composeTurn(withDoc(), { ...ts, auto_renewal_trap: noul(1), unlimited_liability: noul(1), missing_data_protection_clause: noul(1), missing_governing_law: noul(1) }, { citeFlagProbability: false }).reply;
    expect(typesafe).toMatch(/\(90%\)/);
    expect(openai).not.toMatch(/\d+%/);
    expect(openai).toContain("4 compliance flags tripped:");
  });

  it("reflects OpenAI's own different judgments instead of copying TypeSafe's", () => {
    const oa = composeTurn(withDoc(), openaiEquivalent("Analyze this contract", {
      liability_exposure: { value: 0, selfReportedConfidence: 0.9 }, indemnification_harshness: { value: 0, selfReportedConfidence: 0.9 }, termination_rigidity: { value: 0, selfReportedConfidence: 0.9 },
      auto_renewal_trap: { value: false, selfReportedConfidence: 0.9 }, unlimited_liability: { value: false, selfReportedConfidence: 0.9 }, missing_data_protection_clause: { value: false, selfReportedConfidence: 0.9 }, missing_governing_law: { value: false, selfReportedConfidence: 0.9 },
    }), { citeFlagProbability: false });
    expect(oa.reply).toContain("**0% overall risk** (low)");
    expect(oa.reply).toContain("No compliance flags tripped");
  });

  it("applies the guardrails to OpenAI's answers too", () => {
    expect(composeTurn(withDoc(), openaiEquivalent("x", { is_injection_attempt: { value: true, selfReportedConfidence: 0.9 } }), { citeFlagProbability: false }).blocked).toBe("injection");
    expect(composeTurn(withDoc(), openaiEquivalent("x", { contains_privileged_content: { value: true, selfReportedConfidence: 0.9 } }), { citeFlagProbability: false }).blocked).toBe("privileged");
  });

  it("asks a clarifying question when the intent confidence is below the floor", () => {
    const r = composeTurn(withDoc(), openaiEquivalent("hmm", { intent: { value: "small_talk", selfReportedConfidence: 0.2 } }), { citeFlagProbability: false });
    expect(r.reply).toContain("are you looking to (1) analyze");
  });

  it("hedges toward attorney review when a self-reported confidence is low", () => {
    const r = composeTurn(withDoc(), openaiEquivalent("Analyze this contract", { liability_exposure: { value: 2, selfReportedConfidence: 0.3 } }), { citeFlagProbability: false });
    expect(r.reply).toContain("have an attorney confirm");
  });

  it("says so when a risk score could not be computed", () => {
    const answers = analyzeAnswers();
    delete answers.termination_rigidity;
    expect(composeTurn(withDoc(), answers).reply).toContain("couldn't compute a risk score");
  });

  it("asks for a document first when none is loaded", () => {
    expect(composeTurn(createSession("s"), analyzeAnswers()).reply).toContain("Load a document first");
  });

  it("never mutates the session, and hands back a learned contract type instead", () => {
    const session = withDoc();
    const before = JSON.stringify(session);
    const r = composeTurn(session, analyzeAnswers());
    expect(JSON.stringify(session)).toBe(before);
    expect(r.contractType).toBe("saas_subscription");
    expect(composeTurn(session, analyzeAnswers({ contract_type: choice("saas_subscription", 0.2) })).contractType).toBeNull();
  });

  it("marks exactly the answers the reply relied on", () => {
    const r = composeTurn(withDoc(), analyzeAnswers());
    for (const id of ["intent", "urgency", "liability_exposure", "auto_renewal_trap", "contract_type"]) expect(r.used.has(id), id).toBe(true);
  });
});

describe("composeTurn: an answer the backend did not return", () => {
  it("asks how to route instead of crashing when the intent is missing (OpenAI can omit a field)", () => {
    const noIntent = analyzeAnswers();
    delete noIntent.intent;
    const r = composeTurn(withDoc(), noIntent);
    expect(r.reply).toContain("are you looking to (1) analyze");
    expect(r.intent).toBeNull();
    expect(r.risk).toBeNull();
  });

  it("still analyzes when only the urgency is missing, and does not call it urgent", () => {
    const noUrgency = analyzeAnswers();
    delete noUrgency.urgency;
    const r = composeTurn(withDoc(), noUrgency);
    expect(r.risk).not.toBeNull();
    expect(r.reply).not.toContain("time-sensitive");
  });
});
