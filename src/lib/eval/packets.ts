import { COMPLIANCE_CHECKS, type ComplianceCheckId } from "../skills/complianceGuard";
import { RISK_BANDS, RISK_BAND_LABELS, RISK_DIMENSIONS, riskBand, type RiskDimensionId } from "../skills/clauseRisk";
import type { CitationVerdict } from "../skills/citationVerifier";
import type { EvalKind } from "./types";

/**
 * Standardized evidence packets for the judge.
 *
 * Two backends are only comparable if the judge sees their answers rendered
 * identically. Every builder here takes backend-NEUTRAL structured data and
 * emits one fixed format, so nothing a backend happens to include (an
 * explanation, a probability, a self-reported confidence) can tilt its score.
 * Confidence is deliberately left out: the judge grades whether the answer is
 * right, not how sure the answerer claimed to be.
 *
 * Each packet carries everything the rubric (eval-service/rubrics.py) needs to
 * verify the answer from the source text alone: the scoring method, the scale
 * definitions, and the thresholds.
 */
export interface EvalPacket {
  kind: EvalKind;
  /** What the system was asked — fenced by the service as REQUEST. */
  input: string;
  /** The backend's answer in the standard format — fenced as ANSWER. */
  actualOutput: string;
  /** The source text the answer must be supported by — fenced as SOURCE TEXT. */
  context?: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const LEVEL_MARKS = ["0%", "50%", "100%"];

export type EvalScope = "document" | "excerpt";
const scopeLine = (scope: EvalScope) =>
  scope === "excerpt" ? "Scope: a short highlighted excerpt, not the full contract." : "Scope: the full contract.";

// ---- risk ---------------------------------------------------------------

export interface RiskRating {
  id: RiskDimensionId;
  /** 0..1, higher = riskier. */
  normalized: number;
}

export function buildRiskPacket(args: {
  scope: EvalScope;
  ratings: RiskRating[];
  overall: number;
  sourceText: string | null;
}): EvalPacket | null {
  const { scope, ratings, overall, sourceText } = args;
  if (ratings.length === 0 || !sourceText) return null;

  const ids = Object.keys(RISK_DIMENSIONS) as RiskDimensionId[];
  const byId = new Map(ratings.map((r) => [r.id, r.normalized]));
  const method = ids.map((id) => `${RISK_DIMENSIONS[id].weight} x ${RISK_DIMENSIONS[id].label.toLowerCase()}`).join(" + ");
  const bands =
    `${RISK_BAND_LABELS.low}: below ${pct(RISK_BANDS.moderateFrom)}; ${RISK_BAND_LABELS.moderate}: ${pct(RISK_BANDS.moderateFrom)} to below ` +
    `${pct(RISK_BANDS.highFrom)}; ${RISK_BAND_LABELS.high}: ${pct(RISK_BANDS.highFrom)} or above.`;

  const lines = ids
    .filter((id) => byId.has(id))
    .map((id, i) => {
      const dim = RISK_DIMENSIONS[id];
      const scale = dim.criteria.map((c, level) => `${LEVEL_MARKS[level]} = ${c}`).join("; ");
      return `${i + 1}. ${dim.label} (weight ${dim.weight}): ${pct(byId.get(id)!)}\n   Scale: ${scale}`;
    });

  return {
    kind: "risk",
    input: `Rate the overall risk of this contract on liability, indemnification and termination.\n${scopeLine(scope)}`,
    actualOutput: [
      `Overall risk: ${pct(overall)} (${RISK_BAND_LABELS[riskBand(overall)]})`,
      `Method: overall = ${method}. Each rating is a percentage of the top level.`,
      `Bands: ${bands}`,
      "",
      "Ratings:",
      ...lines,
    ].join("\n"),
    context: sourceText,
  };
}

// ---- compliance ---------------------------------------------------------

export interface ComplianceDecision {
  id: ComplianceCheckId;
  flagged: boolean;
}

export function buildCompliancePacket(args: {
  scope: EvalScope;
  decisions: ComplianceDecision[];
  sourceText: string | null;
}): EvalPacket | null {
  const { scope, decisions, sourceText } = args;
  if (decisions.length === 0 || !sourceText) return null;
  const lines = decisions.map((d, i) => {
    const check = COMPLIANCE_CHECKS[d.id];
    return `${i + 1}. ${check.label}\n   Condition: ${check.definition}\n   Decision: ${d.flagged ? "FLAGGED (condition is present)" : "clear (condition is not present)"}`;
  });
  return {
    kind: "compliance",
    input: `Check this contract for common compliance and drafting problems.\n${scopeLine(scope)}`,
    actualOutput: ["Compliance checks:", ...lines].join("\n"),
    context: sourceText,
  };
}

// ---- citation -----------------------------------------------------------

export function buildCitationPacket(args: {
  claim: string;
  quote: string | null;
  verdict: CitationVerdict;
  relation: string | null;
  sectionId: string | null;
  sectionText: string | null;
}): EvalPacket | null {
  const { claim, quote, verdict, relation, sectionId, sectionText } = args;
  if (!sectionText) return null;
  return {
    kind: "citation",
    input: [
      "Verify whether the cited source supports the claim.",
      `CLAIM: ${claim}`,
      quote ? `QUOTE: ${quote}` : "QUOTE: (none supplied; the named source section was checked directly)",
    ].join("\n"),
    actualOutput: [
      `Verdict: ${verdict}`,
      relation ? `Relation of source section to claim: ${relation}` : null,
      sectionId ? `Source section checked: ${sectionId}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    context: sectionText,
  };
}

// ---- assistant reply ----------------------------------------------------

export function buildReplyPacket(args: {
  message: string;
  reply: string;
  risk: { overall: number; ratings: RiskRating[] } | null;
  flags: (ComplianceDecision & { label: string })[];
  sourceText: string | null;
}): EvalPacket | null {
  const { message, reply, risk, flags, sourceText } = args;
  if (!reply) return null;
  const judgments: string[] = [];
  if (risk) {
    const parts = risk.ratings.map((r) => `${RISK_DIMENSIONS[r.id].label} ${pct(r.normalized)}`).join(", ");
    judgments.push(`- Composite risk: ${pct(risk.overall)} (${RISK_BAND_LABELS[riskBand(risk.overall)]}); ${parts}`);
  }
  if (flags.length > 0) {
    judgments.push(`- Compliance: ${flags.map((f) => `${f.label} = ${f.flagged ? "FLAGGED" : "clear"}`).join("; ")}`);
  }
  return {
    kind: "reply",
    input: [
      `USER MESSAGE: ${message}`,
      "JUDGMENTS (the application's own analysis for this turn):",
      ...(judgments.length > 0 ? judgments : ["- (none computed for this turn)"]),
    ].join("\n"),
    actualOutput: reply,
    context: sourceText ?? undefined,
  };
}
