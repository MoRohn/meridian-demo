import { RISK_DIMENSIONS, computeCompositeRisk, type CompositeRisk } from "../skills/clauseRisk";
import { COMPLIANCE_CHECKS, type ComplianceCheckId } from "../skills/complianceGuard";
import type { Answer, NoulAnswer, QuestionSpec, State } from "../typesafe/types";
import type { ComplianceFlag } from "./run";

/**
 * Selecting text in the Document panel and asking "score this" or "check
 * compliance on this" needs the SAME judgments the full-document analysis
 * uses, just scoped to a smaller piece of text. Rather than duplicating the
 * risk/compliance question definitions, this builds the identical question
 * map clauseRisk.ts and complianceGuard.ts already define — those skills'
 * `buildQuestions` don't actually read the session context, only
 * `RISK_DIMENSIONS`/`COMPLIANCE_CHECKS` — and points them at a one-off state
 * shaped exactly like `active_document.text` so their existing
 * backtick-path instructions resolve correctly against the excerpt instead
 * of the whole document.
 */
export function buildExcerptQuestions(): Record<string, QuestionSpec> {
  const questions: Record<string, QuestionSpec> = {};
  for (const [id, dim] of Object.entries(RISK_DIMENSIONS)) {
    questions[id] = { type: "score", instructions: dim.instructions, criteria: [...dim.criteria] };
  }
  for (const [id, check] of Object.entries(COMPLIANCE_CHECKS)) {
    questions[id] = { type: "noul", instructions: check.instructions };
  }
  return questions;
}

export function buildExcerptState(text: string): State {
  return { active_document: { text } };
}

const COMPLIANCE_FLAG_THRESHOLD = 0.55;

/** Same shape as the whole-document ComplianceFlag (run.ts) — one type for both, since page.tsx renders excerpt and whole-document flags through the same components. */
export function buildExcerptComplianceFlags(answers: Record<string, Answer>): ComplianceFlag[] {
  return (Object.keys(COMPLIANCE_CHECKS) as ComplianceCheckId[])
    .filter((id) => answers[id]?.type === "noul")
    .map((id) => {
      const answer = answers[id] as NoulAnswer;
      return {
        id,
        label: COMPLIANCE_CHECKS[id].label,
        probability: answer.noul,
        flagged: answer.noul >= COMPLIANCE_FLAG_THRESHOLD,
      };
    });
}

export function buildExcerptRisk(answers: Record<string, Answer>): CompositeRisk | null {
  return computeCompositeRisk(answers);
}

export const MAX_EXCERPT_CHARS = 20_000;
