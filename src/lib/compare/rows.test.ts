import { describe, expect, it } from "vitest";
import type { ComplianceFlag } from "../orchestrator/run";
import type { OpenAIRunOutcome } from "../openai/types";
import { SAMPLE_CONTRACTS } from "../data/sampleContracts";
import { extractChecks } from "../citations/extract";
import { emptySide, type CitationRun } from "../citations/store";
import type { Judged } from "../citations/batch";
import type { CompositeRisk } from "../skills/clauseRisk";
import { citationGroups, citationRow, mostConsequential, summarizeCitations, complianceGroups, computeOpenAIRisk, dimensionTone, drivingFactor, openaiRatings, overallTone, riskGroups, type Cell, type CellData } from "./rows";

const ok = (answers: Record<string, { value: string | number | boolean; selfReportedConfidence: number | null }>): OpenAIRunOutcome => ({
  ok: true, result: { model: "gpt-4o", answers, usage: { input_tokens: 2100, output_tokens: 610 }, elapsedMs: 6400, source: "live", requestBytes: 1 },
});
const a = (value: string | number | boolean, c: number | null = 0.8) => ({ value, selfReportedConfidence: c });
const data = (c: Cell): CellData => {
  if (typeof c === "string") throw new Error(`expected an answer, got "${c}"`);
  return c;
};

const RISK: CompositeRisk = {
  overall: 0.67, lowestConfidence: 0.5,
  perDimension: [
    { id: "liability_exposure", label: "Liability exposure", normalized: 0.6, confidence: 0.54 },
    { id: "indemnification_harshness", label: "Indemnification harshness", normalized: 0.9, confidence: 0.5 },
    { id: "termination_rigidity", label: "Termination rigidity", normalized: 0.5, confidence: 0.99 },
  ],
};

describe("computeOpenAIRisk and the tones", () => {
  it("normalizes OpenAI's levels like TypeSafe's and weights them by the same code", () => {
    const r = computeOpenAIRisk(ok({ liability_exposure: a(1), indemnification_harshness: a(2), termination_rigidity: a(0) }))!;
    expect(r.byDimension.liability_exposure?.normalized).toBe(0.5);
    expect(r.byDimension.indemnification_harshness?.normalized).toBe(1);
    expect(r.overall).toBeCloseTo(0.5 * 0.5 + 0.3 * 1 + 0.2 * 0, 5);
    expect(openaiRatings(r).map((x) => x.id)).toEqual(["liability_exposure", "indemnification_harshness", "termination_rigidity"]);
  });
  it("has nothing when OpenAI did not answer", () => {
    expect(computeOpenAIRisk(null)).toBeNull();
    expect(computeOpenAIRisk({ ok: false, reason: "error" })).toBeNull();
    expect(computeOpenAIRisk(ok({}))).toBeNull();
  });
  it("tones the composite by its band and each dimension by its own value", () => {
    expect([overallTone(0.2), overallTone(0.5), overallTone(0.66)]).toEqual(["emerald", "amber", "rose"]);
    expect([dimensionTone(0.1), dimensionTone(0.4), dimensionTone(0.9)]).toEqual(["emerald", "amber", "rose"]);
  });
  it("names the dimension driving the total, or says none does", () => {
    expect(drivingFactor(RISK.perDimension)).toBe("Primarily driven by indemnification harshness (weight 0.3).");
    expect(drivingFactor([{ id: "liability_exposure", normalized: 0.1 }])).toContain("No single dimension");
  });
});

describe("riskGroups", () => {
  const openai = computeOpenAIRisk(ok({ liability_exposure: a(1, 0.8), indemnification_harshness: a(2, 0.9), termination_rigidity: a(2, 0.7) }));
  const groups = riskGroups(RISK, openai, true);

  it("has a composite row and one row per dimension, in that order", () => {
    expect(groups.map((g) => g.label)).toEqual(["Composite", "Dimensions"]);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[1].rows.map((r) => r.title)).toEqual(["Liability exposure", "Indemnification harshness", "Termination rigidity"]);
  });
  it("shows the total and its band for both backends, with the reason on the row", () => {
    const row = groups[0].rows[0];
    expect(data(row.ts)).toMatchObject({ main: "67%", sub: "High risk", tone: "rose" });
    expect(row.subtitle).toContain("indemnification harshness");
    expect(data(row.oa).main).toBe(`${Math.round(openai!.overall * 100)}%`);
  });
  it("says a dimension agrees only when both land in the same band, and shows confidence for each side", () => {
    const [liability, indemn, termination] = groups[1].rows;
    expect(data(liability.ts)).toMatchObject({ main: "60%", sub: "confidence 54%", tone: "amber" });
    expect(data(liability.oa)).toMatchObject({ main: "50%", sub: "self-reported 80%" });
    expect(liability.match).toBe(true); // both moderate
    expect(indemn.match).toBe(true); // both high
    expect(termination.match).toBe(false); // 50% moderate vs 100% high
  });
  it("says why OpenAI has no figures rather than showing zero", () => {
    const off = riskGroups(RISK, null, false);
    expect(off[0].rows[0].oa).toBe("not run");
    expect(riskGroups(RISK, null, true)[0].rows[0].oa).toBe("no answer");
    expect(off[1].rows.every((r) => r.match === null)).toBe(true);
  });
});

describe("complianceGroups", () => {
  const flags: ComplianceFlag[] = [
    { id: "auto_renewal_trap", label: "Auto-renewal without adequate notice", probability: 0.84, flagged: true },
    { id: "unlimited_liability", label: "Unlimited or unclear liability", probability: 0.2, flagged: false },
    { id: "missing_governing_law", label: "No governing law / jurisdiction clause", probability: 0.1, flagged: false },
  ];
  const groups = complianceGroups(flags, ok({ auto_renewal_trap: a(true, 0.99), unlimited_liability: a(true, 0.9) }), true);

  it("is one group that counts what tripped", () => {
    expect(groups).toHaveLength(1);
    expect(groups[0].note).toBe("1 of 3 flagged");
  });
  it("shows the decision, its probability and a bar for TypeSafe, and the self-reported confidence for OpenAI", () => {
    const [renewal] = groups[0].rows;
    expect(data(renewal.ts)).toMatchObject({ main: "Flagged", sub: "84% probability", tone: "rose", bar: { value: 0.84, tone: "rose" } });
    expect(data(renewal.oa)).toMatchObject({ main: "Flagged", sub: "self-reported 99%", tone: "rose" });
    expect(renewal.subtitle).toMatch(/renew/i); // the check's own definition
  });
  it("marks agreement by decision, and leaves a question OpenAI did not answer uncompared", () => {
    const [renewal, liability, law] = groups[0].rows;
    expect(renewal.match).toBe(true);
    expect(liability.match).toBe(false); // TypeSafe clear, OpenAI flagged
    expect(law.oa).toBe("no answer");
    expect(law.match).toBeNull();
  });
});

describe("citation rows", () => {
  const employment = extractChecks({ text: SAMPLE_CONTRACTS[2].text, scope: "document" });
  const saas = extractChecks({ text: SAMPLE_CONTRACTS[0].text, scope: "document" });
  const judged = (relation: "supports" | "contradicts" | "says_nothing", confidence: number | null = 0.9, basis: Judged["basis"] = "calibrated"): Judged => ({
    relation, verdict: relation === "supports" ? "verified" : relation === "contradicts" ? "contradicted" : "unsupported", confidence, basis,
  });
  const runOf = (extraction: typeof saas, ts: Record<string, Judged>, oa: Record<string, Judged>, statuses: { ts?: "done" | "pending" | "error"; oa?: "done" | "pending" | "error" | "skipped" } = {}): CitationRun => ({
    sig: "s", extraction, typesafe: { ...emptySide(statuses.ts ?? "done"), judged: ts }, openai: { ...emptySide(statuses.oa ?? "done"), judged: oa },
  });
  const row = (extraction: typeof saas, id: string, run?: CitationRun, configured = true) => citationRow(extraction.checks.find((c) => c.id === id)!, run, configured);

  it("shows a checked term with its playbook origin, the clause quoted, and the figures pulled from it", () => {
    const r = row(saas, "term_termination");
    expect(r).toMatchObject({ tag: "Playbook \u00a76.3", title: "Termination", facts: ["for convenience", "termination fee", "18 months"] });
    expect(r.evidence?.ref).toBe("\u00a76 Termination");
    expect(r.evidence?.quote).toContain("eighteen (18) months");
    expect(r.subtitle).toContain("ninety (90) days");
  });

  it("says each side is still checking until its answer lands", () => {
    const r = row(saas, "term_liability", runOf(saas, {}, {}, { ts: "pending", oa: "pending" }));
    expect([r.ts, r.oa, r.match]).toEqual(["checking\u2026", "checking\u2026", null]);
  });

  it("shows TypeSafe's verdict and calibrated confidence, and OpenAI's with its self-reported one, in one vocabulary", () => {
    const r = row(saas, "term_liability", runOf(saas, { term_liability: judged("contradicts", 0.86) }, { term_liability: judged("contradicts", 0.9, "self-reported") }));
    expect(r.ts).toMatchObject({ main: "Contradicted", sub: "confidence 86%", tone: "rose", bar: { value: 0.86, tone: "rose" } });
    expect(r.oa).toMatchObject({ main: "Contradicted", sub: "self-reported 90%", tone: "rose" });
    expect(r.match).toBe(true);
  });

  it("calls a source that is silent 'Not addressed' and a supporting one 'Supported', and marks a disagreement", () => {
    const r = row(saas, "term_data_protection", runOf(saas, { term_data_protection: judged("says_nothing") }, { term_data_protection: judged("supports") }));
    expect(r.ts).toMatchObject({ main: "Not addressed", tone: "amber" });
    expect(r.oa).toMatchObject({ main: "Supported", tone: "emerald" });
    expect(r.match).toBe(false);
  });

  it("does not put a confidence on an OpenAI answer that reported none", () => {
    const r = row(saas, "term_payment", runOf(saas, { term_payment: judged("supports") }, { term_payment: judged("supports", null, "self-reported") }));
    expect(r.oa).toMatchObject({ main: "Supported", sub: undefined, bar: null });
  });

  it("says OpenAI was not run when it is not configured, and when it failed, and still shows TypeSafe's answer", () => {
    const ts = { term_payment: judged("supports") };
    expect(row(saas, "term_payment", runOf(saas, ts, {}, { oa: "skipped" }), false).oa).toBe("not run");
    expect(row(saas, "term_payment", runOf(saas, ts, {}, { oa: "error" })).oa).toBe("call failed");
    expect(data(row(saas, "term_payment", runOf(saas, ts, {}, { oa: "skipped" }), false).ts).main).toBe("Supported");
  });

  it("shows a rule-decided finding as such, with no model column to fill: a missing term", () => {
    const r = row(saas, "term_governing_law", runOf(saas, {}, {}));
    expect(r.ts).toMatchObject({ main: "Missing", tone: "amber", sub: "No clause on this was found in the document." });
    expect(r.oa).toBe("no model needed");
    expect(r.match).toBeNull();
    expect(r.evidence).toBeUndefined();
  });

  it("shows a broken reference in rose, with the reason", () => {
    const e = extractChecks({ text: "1. Scope. The services are described in Section 9.\n\n2. Fees. Fees are due in thirty (30) days.", scope: "document" });
    const r = citationRow(e.checks.find((c) => c.kind === "reference")!, undefined, true);
    expect(r).toMatchObject({ tag: "Cross-reference", title: "Cites Section 9" });
    expect(r.ts).toMatchObject({ main: "Broken reference", tone: "rose", sub: "Section 9 does not exist in this document." });
    expect(r.evidence?.quote).toContain("Section 9");
  });

  it("shows a reference to a real section as a check of what that section says", () => {
    const r = row(employment, "ref_1", runOf(employment, { ref_1: judged("supports") }, { ref_1: judged("supports") }));
    expect(r).toMatchObject({ tag: "Cross-reference", title: "Cites \u00a74 Restrictive Covenants" });
    expect(r.subtitle).toBe("Does \u00a74 Restrictive Covenants say what this sentence relies on?");
    expect(r.ts).toMatchObject({ main: "Supported" });
  });

  it("groups references before key terms, and leaves a group out when there is nothing in it", () => {
    expect(citationGroups(employment, undefined, true).map((g) => `${g.label} (${g.rows.length})`)).toEqual(["Cited in the text (1)", "Key terms (7)"]);
    expect(citationGroups(saas, undefined, true).map((g) => g.label)).toEqual(["Key terms"]);
    expect(citationGroups({ scope: "document", checks: [], sections: 0 }, undefined, true)).toEqual([]);
  });
});

describe("summarizeCitations and mostConsequential", () => {
  const saas = extractChecks({ text: SAMPLE_CONTRACTS[0].text, scope: "document" });
  const j = (relation: "supports" | "contradicts" | "says_nothing"): Judged => ({ relation, verdict: relation === "supports" ? "verified" : relation === "contradicts" ? "contradicted" : "unsupported", confidence: 0.8, basis: "calibrated" });
  const run: CitationRun = {
    sig: "s", extraction: saas,
    typesafe: { ...emptySide("done"), judged: { term_auto_renewal: j("says_nothing"), term_indemnification: j("contradicts"), term_liability: j("contradicts"), term_data_protection: j("says_nothing"), term_termination: j("contradicts"), term_payment: j("supports") } },
    openai: { ...emptySide("done"), judged: { term_auto_renewal: j("says_nothing"), term_indemnification: j("supports"), term_liability: j("contradicts") } },
  };

  it("counts every check once, by what TypeSafe found, with the rule-decided ones separate", () => {
    expect(summarizeCitations(saas, run)).toEqual({ total: 7, supported: 1, contradicted: 3, notAddressed: 2, broken: 0, missing: 1, notCheckable: 0, pending: 0, compared: 3, agreed: 2 });
  });
  it("counts checks with no answer yet as pending, not as anything else", () => {
    expect(summarizeCitations(saas, undefined)).toMatchObject({ total: 7, pending: 6, missing: 1, supported: 0, contradicted: 0, compared: 0 });
  });
  it("picks a contradiction to have the judge score first, then a silent source, then a supported claim, and nothing before there are answers", () => {
    expect(mostConsequential(saas, run)).toBe("term_indemnification");
    expect(mostConsequential(saas, { ...run, typesafe: { ...run.typesafe, judged: { term_data_protection: j("says_nothing"), term_payment: j("supports") } } })).toBe("term_data_protection");
    expect(mostConsequential(saas, { ...run, typesafe: { ...run.typesafe, judged: { term_payment: j("supports") } } })).toBe("term_payment");
    expect(mostConsequential(saas, undefined)).toBeNull();
  });
});
