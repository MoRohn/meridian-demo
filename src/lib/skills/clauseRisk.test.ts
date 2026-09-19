import { describe, expect, it } from "vitest";
import { computeCompositeRisk, RISK_DIMENSIONS } from "./clauseRisk";
import type { Answer, ScoreAnswer } from "../typesafe/types";

function scoreAnswer(score: number, confidence = 0.9): ScoreAnswer {
  return { type: "score", score, legend: {}, probabilities: {}, confidence };
}

describe("computeCompositeRisk", () => {
  it("returns null when a required dimension is missing", () => {
    expect(computeCompositeRisk({})).toBeNull();
    expect(computeCompositeRisk({ liability_exposure: scoreAnswer(1) })).toBeNull();
  });

  it("returns null when a dimension answer is not a score", () => {
    const answers: Record<string, Answer> = {
      liability_exposure: { type: "noul", noul: 0.5 },
      indemnification_harshness: scoreAnswer(0),
      termination_rigidity: scoreAnswer(0),
    };
    expect(computeCompositeRisk(answers)).toBeNull();
  });

  it("weights the three dimensions exactly as documented (0.5 / 0.3 / 0.2)", () => {
    expect(RISK_DIMENSIONS.liability_exposure.weight).toBe(0.5);
    expect(RISK_DIMENSIONS.indemnification_harshness.weight).toBe(0.3);
    expect(RISK_DIMENSIONS.termination_rigidity.weight).toBe(0.2);
  });

  it("computes overall = 0 when every dimension is at its safest level", () => {
    const answers: Record<string, Answer> = {
      liability_exposure: scoreAnswer(0),
      indemnification_harshness: scoreAnswer(0),
      termination_rigidity: scoreAnswer(0),
    };
    const result = computeCompositeRisk(answers);
    expect(result?.overall).toBe(0);
  });

  it("computes overall = 1 when every dimension is at its riskiest level", () => {
    const answers: Record<string, Answer> = {
      liability_exposure: scoreAnswer(2),
      indemnification_harshness: scoreAnswer(2),
      termination_rigidity: scoreAnswer(2),
    };
    const result = computeCompositeRisk(answers);
    expect(result?.overall).toBe(1);
  });

  it("surfaces the lowest confidence across dimensions", () => {
    const answers: Record<string, Answer> = {
      liability_exposure: scoreAnswer(1, 0.95),
      indemnification_harshness: scoreAnswer(1, 0.3),
      termination_rigidity: scoreAnswer(1, 0.8),
    };
    const result = computeCompositeRisk(answers);
    expect(result?.lowestConfidence).toBe(0.3);
  });
});
