import { describe, expect, it } from "vitest";
import {
  buildCitationPacket,
  buildCompliancePacket,
  buildReplyPacket,
  buildRiskPacket,
} from "./packets";
import { riskBand } from "../skills/clauseRisk";

const DOC = "1. Liability. Unlimited.";
const RATINGS = [
  { id: "liability_exposure", normalized: 1 },
  { id: "indemnification_harshness", normalized: 0.5 },
  { id: "termination_rigidity", normalized: 0 },
] as const;

describe("buildRiskPacket", () => {
  const packet = buildRiskPacket({ scope: "document", ratings: [...RATINGS], overall: 0.65, sourceText: DOC })!;

  it("states the method, weights, scale definitions and bands so the judge can verify the arithmetic", () => {
    expect(packet.kind).toBe("risk");
    expect(packet.actualOutput).toContain("Overall risk: 65% (Moderate risk)");
    expect(packet.actualOutput).toContain("0.5 x liability exposure + 0.3 x indemnification harshness + 0.2 x termination rigidity");
    expect(packet.actualOutput).toContain("Moderate risk: 33% to below 66%");
    expect(packet.actualOutput).toContain("1. Liability exposure (weight 0.5): 100%");
    expect(packet.actualOutput).toMatch(/Scale: 0% = .*; 50% = .*; 100% = /);
    expect(packet.context).toBe(DOC);
  });

  it("marks excerpt scope so the judge does not penalize dimensions an excerpt cannot cover", () => {
    const ex = buildRiskPacket({ scope: "excerpt", ratings: [...RATINGS], overall: 0.5, sourceText: "x" })!;
    expect(ex.input).toContain("short highlighted excerpt");
  });

  it("contains no confidence figures, so a backend cannot gain by self-reporting more", () => {
    expect(packet.actualOutput.toLowerCase()).not.toContain("confidence");
  });

  it("returns null when there is nothing to judge", () => {
    expect(buildRiskPacket({ scope: "document", ratings: [], overall: 0, sourceText: DOC })).toBeNull();
    expect(buildRiskPacket({ scope: "document", ratings: [...RATINGS], overall: 0.5, sourceText: null })).toBeNull();
  });

  it("tells the judge every percentage is rounded, so rounding is never mistaken for an arithmetic error", () => {
    expect(packet.actualOutput).toContain("All percentages are rounded to whole numbers.");
  });

  it("is byte-identical in structure for two backends given the same answers (like-for-like)", () => {
    const a = buildRiskPacket({ scope: "document", ratings: [...RATINGS], overall: 0.65, sourceText: DOC });
    const b = buildRiskPacket({ scope: "document", ratings: [...RATINGS], overall: 0.65, sourceText: DOC });
    expect(a).toEqual(b);
  });
});

describe("riskBand", () => {
  it("labels a total by the whole percentage that is displayed, so text and band cannot disagree", () => {
    for (let n = 0; n <= 1000; n++) {
      const overall = n / 1000;
      const shown = Math.round(overall * 100);
      const expected = shown >= 66 ? "high" : shown >= 33 ? "moderate" : "low";
      expect(riskBand(overall), `${overall} shows as ${shown}%`).toBe(expected);
    }
  });
  it("uses the same edges the packet documents", () => {
    expect(riskBand(0.32)).toBe("low");
    expect(riskBand(0.33)).toBe("moderate");
    expect(riskBand(0.654)).toBe("moderate");
    expect(riskBand(0.655)).toBe("high"); // shown as 66%, so labelled like 66%
    expect(riskBand(0.66)).toBe("high");
  });
});

describe("buildCompliancePacket", () => {
  it("lists each check's definition next to its decision, with no probabilities", () => {
    const p = buildCompliancePacket({
      scope: "document",
      decisions: [
        { id: "auto_renewal_trap", flagged: true },
        { id: "missing_governing_law", flagged: false },
      ],
      sourceText: DOC,
    })!;
    expect(p.actualOutput).toContain("Decision: FLAGGED (condition is present)");
    expect(p.actualOutput).toContain("Decision: clear (condition is not present)");
    expect(p.actualOutput).toContain("Condition: The agreement renews automatically");
    expect(p.actualOutput).not.toMatch(/\d+%/);
  });
});

describe("buildCitationPacket", () => {
  const base = { claim: "C", verdict: "verified" as const, relation: "supports", sectionId: "2.1", sectionText: "S" };
  it("carries claim, quote, verdict and relation", () => {
    const p = buildCitationPacket({ ...base, quote: "Q" })!;
    expect(p.input).toContain("CLAIM: C");
    expect(p.input).toContain("QUOTE: Q");
    expect(p.actualOutput).toContain("Verdict: verified");
    expect(p.actualOutput).toContain("Relation of source section to claim: supports");
    expect(p.context).toBe("S");
  });
  it("says so plainly when no quote was supplied", () => {
    expect(buildCitationPacket({ ...base, quote: null })!.input).toContain("none supplied");
  });
  it("returns null without a source section (a fabricated quote is never sent to the judge)", () => {
    expect(buildCitationPacket({ ...base, quote: "Q", sectionText: null })).toBeNull();
  });
});

describe("buildReplyPacket", () => {
  it("includes the application's own judgments so the reply is checked against them", () => {
    const p = buildReplyPacket({
      message: "Analyze this contract",
      reply: "66% overall risk",
      risk: { overall: 0.66, ratings: [...RATINGS] },
      flags: [{ id: "missing_governing_law", label: "No governing law", flagged: true }],
      sourceText: DOC,
    })!;
    expect(p.input).toContain("USER MESSAGE: Analyze this contract");
    expect(p.input).toContain("Composite risk: 66% (High risk)");
    expect(p.input).toContain("No governing law = FLAGGED");
    expect(p.actualOutput).toBe("66% overall risk");
  });
  it("includes a flag's probability when the backend has one, so a reply that quotes it is grounded", () => {
    const p = buildReplyPacket({ message: "m", reply: "r", risk: null, flags: [{ id: "missing_governing_law", label: "No governing law", flagged: true, probability: 0.85 }], sourceText: null })!;
    expect(p.input).toContain("No governing law = FLAGGED (85%)");
  });
  it("leaves the probability out for a backend that has none (OpenAI's flags carry only a decision)", () => {
    const p = buildReplyPacket({ message: "m", reply: "r", risk: null, flags: [{ id: "missing_governing_law", label: "No governing law", flagged: true }], sourceText: null })!;
    expect(p.input).toMatch(/No governing law = FLAGGED$/m);
    expect(p.input).not.toMatch(/FLAGGED \(/);
  });
  it("returns null for an empty reply", () => {
    expect(buildReplyPacket({ message: "m", reply: "", risk: null, flags: [], sourceText: null })).toBeNull();
  });
});

describe("the rounding tolerance the risk rubric grants", () => {
  it("covers the worst case: the total recomputed from ROUNDED ratings never differs from the rounded total by more than 1 point", () => {
    // The rubric lets the judge accept up to 2 points; this shows the real worst case is well inside that, so
    // a correct answer can never be marked down for arithmetic that rounding alone explains.
    const W = [0.5, 0.3, 0.2];
    let worst = 0;
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 20000; i++) {
      const r = W.map(() => rand());
      const overall = r.reduce((s, v, k) => s + v * W[k], 0);
      const recomputed = r.reduce((s, v, k) => s + Math.round(v * 100) * W[k], 0);
      worst = Math.max(worst, Math.abs(recomputed - Math.round(overall * 100)));
    }
    expect(worst).toBeLessThanOrEqual(1);
  });
});
