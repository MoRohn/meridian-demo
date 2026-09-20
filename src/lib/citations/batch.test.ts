import { describe, expect, it } from "vitest";
import { SAMPLE_CONTRACTS } from "../data/sampleContracts";
import { mockSystemOne } from "../typesafe/mock";
import { buildBatch, judgedFromOpenAI, judgedFromTypesafe, questionId } from "./batch";
import { extractChecks } from "./extract";

describe("buildBatch", () => {
  const checks = [
    { id: "term_liability", claim: "Liability is capped.", source: "4. Limitation of Liability. Liability shall not exceed $50,000." },
    { id: "ref_1", claim: "See Section 4.", source: "4. Restrictions. None." },
  ];
  const batch = buildBatch(checks)!;

  it("puts every check's claim and source in the state, addressed by id", () => {
    expect(batch.state).toEqual({ checks: { term_liability: { claim: checks[0].claim, source_section: checks[0].source }, ref_1: { claim: checks[1].claim, source_section: checks[1].source } } });
  });

  it("asks one three-way Choice per check, pointing at that check's own claim and source", () => {
    expect(Object.keys(batch.questions)).toEqual(["relation_term_liability", "relation_ref_1"]);
    const q = batch.questions[questionId("ref_1")];
    expect(q).toMatchObject({ type: "choice", instructions: "How does `checks.ref_1.source_section` relate to `checks.ref_1.claim`?" });
    expect(Object.keys((q as { criteria: object }).criteria)).toEqual(["supports", "contradicts", "says_nothing"]);
  });

  it("has nothing to ask when there are no checks", () => {
    expect(buildBatch([])).toBeNull();
  });
});

describe("reading the answers back", () => {
  it("turns TypeSafe's choice into a relation, a verdict and a calibrated confidence", () => {
    const j = judgedFromTypesafe({ relation_a: { type: "choice", choice: "contradicts", probabilities: { contradicts: 0.9, supports: 0.05, says_nothing: 0.05 }, confidence: 0.82 } }, ["a"]);
    expect(j.a).toMatchObject({ relation: "contradicts", verdict: "contradicted", confidence: 0.82, basis: "calibrated" });
  });
  it("turns OpenAI's value into the same, with a self-reported confidence, or none", () => {
    const j = judgedFromOpenAI({ relation_a: { value: "supports", selfReportedConfidence: 0.9 }, relation_b: { value: "says_nothing", selfReportedConfidence: null } }, ["a", "b"]);
    expect(j.a).toMatchObject({ relation: "supports", verdict: "verified", confidence: 0.9, basis: "self-reported" });
    expect(j.b).toMatchObject({ verdict: "unsupported", confidence: null });
  });
  it("leaves out a check the backend did not answer, or answered with something that is not a relation", () => {
    expect(judgedFromTypesafe({}, ["a"])).toEqual({});
    expect(judgedFromTypesafe({ relation_a: { type: "noul", noul: 1 } }, ["a"])).toEqual({});
    expect(judgedFromOpenAI({ relation_a: { value: "maybe", selfReportedConfidence: 1 } }, ["a"])).toEqual({});
  });
});

describe("a whole document in one request, on the demo evaluator", () => {
  const saas = SAMPLE_CONTRACTS[0];
  const checks = extractChecks({ text: saas.text, scope: "document" }).checks.filter((c) => c.resolution === "model").map((c) => ({ id: c.id, claim: c.claim, source: c.source! }));
  const batch = buildBatch(checks)!;
  const answers = mockSystemOne(batch.state, batch.questions, "jev-latest").answers;
  const judged = judgedFromTypesafe(answers, checks.map((c) => c.id));

  it("answers every check in the one request", () => {
    expect(Object.keys(judged).sort()).toEqual(checks.map((c) => c.id).sort());
  });

  it("uses each check's own claim and source, not another's: an uncapped clause does not support a cap, and is not read as silent", () => {
    expect(judged.term_liability.relation).toBe("contradicts");
  });

  it("gives each answer a confidence between 0 and 1", () => {
    for (const j of Object.values(judged)) {
      expect(j.confidence).toBeGreaterThanOrEqual(0);
      expect(j.confidence).toBeLessThanOrEqual(1);
    }
  });
});
