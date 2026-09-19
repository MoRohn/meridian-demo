import { describe, expect, it } from "vitest";
import { agrees, agreementSummary, openaiAnswerFor, typesafeSummary } from "./agreement";
import type { OpenAIRunOutcome } from "../openai/types";
import type { TraceEntry } from "../orchestrator/run";

describe("openaiAnswerFor", () => {
  it("returns null when the outcome is null", () => {
    expect(openaiAnswerFor(null, "anything")).toBeNull();
  });

  it("returns null when the outcome failed", () => {
    const outcome: OpenAIRunOutcome = { ok: false, reason: "not_configured" };
    expect(openaiAnswerFor(outcome, "anything")).toBeNull();
  });

  it("returns the answer for a matching question id on a successful outcome", () => {
    const outcome: OpenAIRunOutcome = {
      ok: true,
      result: {
        model: "gpt-4o-mini",
        answers: { relation: { value: "contradicts", selfReportedConfidence: 0.9 } },
        usage: { input_tokens: 10, output_tokens: 2 },
        elapsedMs: 5,
        source: "live",
        requestBytes: 100,
      },
    };
    expect(openaiAnswerFor(outcome, "relation")).toEqual({ value: "contradicts", selfReportedConfidence: 0.9 });
    expect(openaiAnswerFor(outcome, "missing_question")).toBeNull();
  });
});

describe("agrees", () => {
  it("compares a noul answer against a boolean threshold at 0.5", () => {
    expect(agrees({ type: "noul", noul: 0.7 }, true)).toBe(true);
    expect(agrees({ type: "noul", noul: 0.3 }, true)).toBe(false);
    expect(agrees({ type: "noul", noul: 0.3 }, false)).toBe(true);
  });

  it("compares a choice answer by exact string match", () => {
    const answer = { type: "choice" as const, choice: "contradicts", probabilities: {}, confidence: 0.9 };
    expect(agrees(answer, "contradicts")).toBe(true);
    expect(agrees(answer, "supports")).toBe(false);
  });

  it("compares a score answer by rounding to the nearest integer level", () => {
    const answer = { type: "score" as const, score: 1.4, legend: {}, probabilities: {}, confidence: 0.9 };
    expect(agrees(answer, 1)).toBe(true);
    expect(agrees(answer, 2)).toBe(false);
  });
});

describe("typesafeSummary", () => {
  it("labels a noul answer yes/no with no confidence (uncalibrated concept doesn't apply)", () => {
    expect(typesafeSummary({ type: "noul", noul: 0.9 })).toEqual({ label: "yes", confidence: null });
    expect(typesafeSummary({ type: "noul", noul: 0.1 })).toEqual({ label: "no", confidence: null });
  });

  it("labels a choice answer with its choice and confidence", () => {
    const answer = { type: "choice" as const, choice: "nda", probabilities: {}, confidence: 0.8 };
    expect(typesafeSummary(answer)).toEqual({ label: "nda", confidence: 0.8 });
  });

  it("labels a score answer with its rounded level", () => {
    const answer = { type: "score" as const, score: 1.6, legend: {}, probabilities: {}, confidence: 0.7 };
    expect(typesafeSummary(answer)).toEqual({ label: "level 2", confidence: 0.7 });
  });
});

function traceEntry(questionId: string, answer: TraceEntry["answer"]): TraceEntry {
  return { skill: "test", questionId, question: { type: answer.type, instructions: "" } as never, answer, used: true };
}

describe("agreementSummary", () => {
  it("only counts questions OpenAI actually answered", () => {
    const trace = [traceEntry("a", { type: "noul", noul: 0.9 }), traceEntry("b", { type: "noul", noul: 0.1 })];
    const outcome: OpenAIRunOutcome = {
      ok: true,
      result: {
        model: "gpt-4o-mini",
        answers: { a: { value: true, selfReportedConfidence: 0.9 } },
        usage: { input_tokens: 1, output_tokens: 1 },
        elapsedMs: 1,
        source: "live",
        requestBytes: 100,
      },
    };
    expect(agreementSummary(trace, outcome)).toEqual({ agreed: 1, compared: 1 });
  });

  it("returns 0/0 when OpenAI has no outcome at all", () => {
    const trace = [traceEntry("a", { type: "noul", noul: 0.9 })];
    expect(agreementSummary(trace, null)).toEqual({ agreed: 0, compared: 0 });
  });

  it("counts a real disagreement", () => {
    const trace = [traceEntry("a", { type: "choice", choice: "nda", probabilities: {}, confidence: 0.9 })];
    const outcome: OpenAIRunOutcome = {
      ok: true,
      result: {
        model: "gpt-4o-mini",
        answers: { a: { value: "saas_msa", selfReportedConfidence: 0.8 } },
        usage: { input_tokens: 1, output_tokens: 1 },
        elapsedMs: 1,
        source: "live",
        requestBytes: 100,
      },
    };
    expect(agreementSummary(trace, outcome)).toEqual({ agreed: 0, compared: 1 });
  });
});
