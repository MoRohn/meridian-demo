import { describe, expect, it } from "vitest";
import { buildExcerptComplianceFlags, buildExcerptQuestions, buildExcerptRisk, buildExcerptState } from "./excerpt";
import { RISK_DIMENSIONS } from "../skills/clauseRisk";
import { COMPLIANCE_CHECKS } from "../skills/complianceGuard";
import type { Answer } from "../typesafe/types";

describe("buildExcerptState", () => {
  it("shapes the excerpt as active_document.text, so existing skills' backtick-path instructions resolve unchanged", () => {
    expect(buildExcerptState("some text")).toEqual({ active_document: { text: "some text" } });
  });
});

describe("buildExcerptQuestions", () => {
  it("includes every risk dimension and every compliance check, and nothing else", () => {
    const questions = buildExcerptQuestions();
    const ids = Object.keys(questions).sort();
    const expected = [...Object.keys(RISK_DIMENSIONS), ...Object.keys(COMPLIANCE_CHECKS)].sort();
    expect(ids).toEqual(expected);
  });

  it("builds risk dimensions as score questions and compliance checks as noul questions", () => {
    const questions = buildExcerptQuestions();
    for (const id of Object.keys(RISK_DIMENSIONS)) {
      expect(questions[id].type).toBe("score");
    }
    for (const id of Object.keys(COMPLIANCE_CHECKS)) {
      expect(questions[id].type).toBe("noul");
    }
  });
});

describe("buildExcerptRisk", () => {
  it("returns null when the answers don't cover every risk dimension", () => {
    expect(buildExcerptRisk({})).toBeNull();
  });

  it("computes a composite score identically to the whole-document path (same computeCompositeRisk)", () => {
    const answers: Record<string, Answer> = {
      liability_exposure: { type: "score", score: 2, legend: {}, probabilities: {}, confidence: 0.9 },
      indemnification_harshness: { type: "score", score: 0, legend: {}, probabilities: {}, confidence: 0.9 },
      termination_rigidity: { type: "score", score: 0, legend: {}, probabilities: {}, confidence: 0.9 },
    };
    const risk = buildExcerptRisk(answers);
    expect(risk?.overall).toBe(1 * 0.5); // only liability maxed out, weight 0.5
  });
});

describe("buildExcerptComplianceFlags", () => {
  it("flags a check once its probability crosses the 0.55 threshold", () => {
    const answers: Record<string, Answer> = {
      auto_renewal_trap: { type: "noul", noul: 0.6 },
      unlimited_liability: { type: "noul", noul: 0.4 },
      missing_data_protection_clause: { type: "noul", noul: 0.1 },
      missing_governing_law: { type: "noul", noul: 0.9 },
    };
    const flags = buildExcerptComplianceFlags(answers);
    const byId = Object.fromEntries(flags.map((f) => [f.id, f.flagged]));
    expect(byId.auto_renewal_trap).toBe(true);
    expect(byId.unlimited_liability).toBe(false);
    expect(byId.missing_data_protection_clause).toBe(false);
    expect(byId.missing_governing_law).toBe(true);
  });

  it("skips any check whose answer is missing or the wrong answer type", () => {
    const flags = buildExcerptComplianceFlags({ auto_renewal_trap: { type: "noul", noul: 0.9 } });
    expect(flags).toHaveLength(1);
    expect(flags[0].id).toBe("auto_renewal_trap");
  });
});
