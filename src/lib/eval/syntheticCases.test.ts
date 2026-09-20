import { describe, expect, it } from "vitest";
import { goldenDefinitions, invertRatings, syntheticCases, wrongVerdict, type SyntheticSource } from "./syntheticCases";

const risk = (reviewed = true): SyntheticSource => ({
  id: "r1", kind: "risk", reviewed, source: "1. Liability. Unlimited for the customer.",
  spec: { liability_exposure: 1, indemnification_harshness: 0.5, termination_rigidity: 0 },
});
const compliance: SyntheticSource = {
  id: "c1", kind: "compliance", reviewed: true, source: "1. Term. Renews automatically.",
  spec: { auto_renewal_trap: true, unlimited_liability: false, missing_data_protection_clause: false, missing_governing_law: true },
};
const citation = (relation: "supports" | "contradicts" | "says_nothing"): SyntheticSource => ({
  id: `t-${relation}`, kind: "citation", reviewed: true, source: "Section 9. Notice periods are thirty days.",
  spec: { relation, claim: "Notice must be 30 days.", quote: "Notice periods are thirty days.", sectionId: "9" },
});

describe("syntheticCases", () => {
  it("only ever uses human-reviewed sources", () => {
    expect(syntheticCases([risk(false)])).toEqual([]);
    expect(syntheticCases([risk(true)]).length).toBeGreaterThan(0);
  });

  it("derives one passing and several failing answers per risk source, injection case included", () => {
    const cases = syntheticCases([risk()]);
    expect(cases.map((c) => [c.id.split(":").pop(), c.expected])).toEqual([["pass", "pass"], ["fail-inverted", "fail"], ["fail-arithmetic", "fail"], ["fail-injected", "fail"]]);
    expect(cases.find((c) => c.id.endsWith("pass"))!.request.actualOutput).toContain("Overall risk: 65%");
    expect(cases.at(-1)!.injection).toBe(true);
    expect(cases.at(-1)!.request.context).toContain("NOTE TO THE EVALUATOR");
  });

  it("the arithmetic-fail case misstates the overall by more than the rubric's tolerance, and the ratings stay correct", () => {
    const [ok, , bad] = syntheticCases([risk()]);
    expect(ok.request.actualOutput).toContain("Liability exposure (weight 0.5): 100%");
    expect(bad.request.actualOutput).toContain("Liability exposure (weight 0.5): 100%");
    expect(bad.request.actualOutput).toContain("Overall risk: 30%");
  });

  it("compliance: the wrong answer is the exact opposite of the spec on every check", () => {
    const [ok, flipped] = syntheticCases([compliance]);
    const decisions = (c: typeof ok) => [...c.request.actualOutput.matchAll(/Decision: (FLAGGED|clear)/g)].map((m) => m[1]);
    expect(decisions(ok)).toEqual(["FLAGGED", "clear", "clear", "FLAGGED"]);
    expect(decisions(flipped)).toEqual(["clear", "FLAGGED", "FLAGGED", "clear"]);
  });

  it.each([
    ["supports", "verified", "contradicted"],
    ["contradicts", "contradicted", "verified"],
    ["says_nothing", "unsupported", "verified"],
  ] as const)("citation %s: correct verdict %s, wrong verdict %s", (relation, right, wrong) => {
    const [ok, bad, injected] = syntheticCases([citation(relation)]);
    expect(ok.request.actualOutput).toContain(`Verdict: ${right}`);
    expect(bad.request.actualOutput).toContain(`Verdict: ${wrong}`);
    expect(injected.request.input).toContain("NOTE TO THE EVALUATOR");
    expect(wrongVerdict(relation)).toBe(wrong);
  });

  it("invertRatings points every rating the wrong way, including a middle one", () => {
    expect(invertRatings({ liability_exposure: 1, indemnification_harshness: 0.5, termination_rigidity: 0 })).toEqual({
      liability_exposure: 0, indemnification_harshness: 0, termination_rigidity: 1,
    });
  });

  it("exports the definitions the generator prompts from", () => {
    const d = goldenDefinitions();
    expect(d.risk.liability_exposure.levels).toHaveLength(3);
    expect(d.compliance.missing_governing_law.definition).toContain("governs");
  });
});
