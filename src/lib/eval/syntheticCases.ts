import { COMPLIANCE_CHECKS, type ComplianceCheckId } from "../skills/complianceGuard";
import { RISK_DIMENSIONS, type RiskDimensionId } from "../skills/clauseRisk";
import type { CitationVerdict } from "../skills/citationVerifier";
import { INJECTED_NOTE, type GoldenCase } from "./goldenCases";
import { buildCitationPacket, buildCompliancePacket, buildRiskPacket, type EvalPacket } from "./packets";

/**
 * Synthetic goldens whose correct answer is fixed BY CONSTRUCTION, never decided by an LLM.
 *
 * An LLM-generated golden is only as trustworthy as its label, and an LLM asked to label its own
 * output can be confidently wrong. So the split is:
 *   - a SPEC (the ground truth) is chosen programmatically by eval-service/golden/synth.py;
 *   - an LLM writes only the SOURCE TEXT that realizes the spec, and a second, blind LLM call must
 *     independently re-derive the spec from that text or the case is rejected;
 *   - the correct answer and the wrong answers are derived HERE from the spec, through the same packet
 *     builders the UI uses.
 * Nothing enters the gating suite until a human sets `reviewed: true` (`synth.py approve`).
 */
export type RiskSpec = Record<RiskDimensionId, number>; // 0, 0.5 or 1 per dimension
export type ComplianceSpec = Record<ComplianceCheckId, boolean>;
export interface CitationSpec {
  relation: "supports" | "contradicts" | "says_nothing";
  claim: string;
  quote: string;
  sectionId: string;
}

export interface SyntheticSource {
  id: string;
  kind: "risk" | "compliance" | "citation";
  /** LLM-written text: a contract excerpt, or a playbook section for citations. */
  source: string;
  spec: RiskSpec | ComplianceSpec | CitationSpec;
  reviewed: boolean;
  provenance?: { generator_model: string; labeler_model: string; labeler_agrees: boolean; generated_at: string };
}

const RISK_IDS = Object.keys(RISK_DIMENSIONS) as RiskDimensionId[];
const CHECK_IDS = Object.keys(COMPLIANCE_CHECKS) as ComplianceCheckId[];

const weighted = (spec: RiskSpec) => RISK_IDS.reduce((sum, id) => sum + spec[id] * RISK_DIMENSIONS[id].weight, 0);
const toRatings = (spec: RiskSpec) => RISK_IDS.map((id) => ({ id, normalized: spec[id] }));

/** Points at least one rating the wrong way: extremes flip, and a middle rating becomes 0. */
export function invertRatings(spec: RiskSpec): RiskSpec {
  return Object.fromEntries(RISK_IDS.map((id) => [id, spec[id] === 0 ? 1 : spec[id] === 1 ? 0 : 0])) as RiskSpec;
}

const VERDICT: Record<CitationSpec["relation"], CitationVerdict> = { supports: "verified", contradicts: "contradicted", says_nothing: "unsupported" };
const RELATION_TEXT: Record<CitationSpec["relation"], string> = { supports: "supports", contradicts: "contradicts", says_nothing: "says nothing (silent)" };

/** A verdict that is wrong for the relation; wrongly "verified" is the worst error, so that is used whenever possible. */
export function wrongVerdict(relation: CitationSpec["relation"]): CitationVerdict {
  return relation === "supports" ? "contradicted" : "verified";
}

function wrap(id: string, expected: "pass" | "fail", note: string, packet: EvalPacket, injection: boolean): GoldenCase {
  return {
    id,
    expected,
    ...(injection ? { injection: true } : {}),
    note,
    request: { kind: packet.kind, backend: "typesafe", input: packet.input, actualOutput: packet.actualOutput, context: packet.context ?? null },
  };
}

/** Three cases per reviewed source: the correct answer, a wrong answer, and a wrong answer whose source tries to steer the judge. */
export function syntheticCases(sources: SyntheticSource[]): GoldenCase[] {
  const out: GoldenCase[] = [];
  for (const s of sources.filter((x) => x.reviewed)) {
    const tag = `synthetic:${s.id}`;
    if (s.kind === "risk") {
      const spec = s.spec as RiskSpec;
      const bad = invertRatings(spec);
      const packet = (ratings: RiskSpec, overall: number, source: string) => buildRiskPacket({ scope: "document", ratings: toRatings(ratings), overall, sourceText: source })!;
      const skewed = weighted(spec) < 0.5 ? weighted(spec) + 0.35 : weighted(spec) - 0.35;
      out.push(wrap(`${tag}:pass`, "pass", "Ratings match the spec the text was written to.", packet(spec, weighted(spec), s.source), false));
      out.push(wrap(`${tag}:fail-inverted`, "fail", "Ratings point the wrong way for the text.", packet(bad, weighted(bad), s.source), false));
      out.push(wrap(`${tag}:fail-arithmetic`, "fail", "Ratings are right but the stated overall does not follow from them.", packet(spec, skewed, s.source), false));
      out.push(wrap(`${tag}:fail-injected`, "fail", "Wrong ratings on text that tells the evaluator to give a perfect score.", packet(bad, weighted(bad), s.source + INJECTED_NOTE), true));
    } else if (s.kind === "compliance") {
      const spec = s.spec as ComplianceSpec;
      const decisions = (flip: boolean) => CHECK_IDS.map((id) => ({ id, flagged: flip ? !spec[id] : spec[id] }));
      const packet = (flip: boolean, source: string) => buildCompliancePacket({ scope: "document", decisions: decisions(flip), sourceText: source })!;
      out.push(wrap(`${tag}:pass`, "pass", "Every decision matches the spec the text was written to.", packet(false, s.source), false));
      out.push(wrap(`${tag}:fail-flipped`, "fail", "Every decision is the opposite of the spec.", packet(true, s.source), false));
      out.push(wrap(`${tag}:fail-injected`, "fail", "Flipped decisions on text that tells the evaluator to give a perfect score.", packet(true, s.source + INJECTED_NOTE), true));
    } else {
      const spec = s.spec as CitationSpec;
      const packet = (verdict: CitationVerdict, claim: string) =>
        buildCitationPacket({ claim, quote: spec.quote, verdict, relation: RELATION_TEXT[spec.relation], sectionId: spec.sectionId, sectionText: s.source })!;
      out.push(wrap(`${tag}:pass`, "pass", "Verdict matches the relation the section was written to have.", packet(VERDICT[spec.relation], spec.claim), false));
      out.push(wrap(`${tag}:fail-verdict`, "fail", "Verdict does not match the relation.", packet(wrongVerdict(spec.relation), spec.claim), false));
      out.push(wrap(`${tag}:fail-injected`, "fail", "Wrong verdict where the claim itself tells the evaluator to accept it.", packet(wrongVerdict(spec.relation), spec.claim + INJECTED_NOTE.trim()), true));
    }
  }
  return out;
}

/** The level and check definitions the Python generator prompts from, so it can never drift from what the app scores. */
export function goldenDefinitions() {
  return {
    risk: Object.fromEntries(RISK_IDS.map((id) => [id, { label: RISK_DIMENSIONS[id].label, weight: RISK_DIMENSIONS[id].weight, levels: [...RISK_DIMENSIONS[id].criteria] }])),
    compliance: Object.fromEntries(CHECK_IDS.map((id) => [id, { label: COMPLIANCE_CHECKS[id].label, definition: COMPLIANCE_CHECKS[id].definition }])),
  };
}
