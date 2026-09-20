import type { Answer, QuestionSpec, ScoreAnswer, Skill } from "../typesafe/types";
import type { TurnContext } from "../orchestrator/state";

/**
 * Composite scoring pattern (docs.typesafe.ai/patterns/composite-scoring):
 * "overall contract risk" is not one judgment a model can make reliably —
 * it depends on several independent, unrelated dimensions. So we ask three
 * narrow Score questions in the same fan-out call and combine them with
 * weights we own in code. Changing what "risk" means for a client is a
 * one-line weight change here, not a prompt rewrite.
 */
export const RISK_DIMENSIONS = {
  liability_exposure: {
    label: "Liability exposure",
    summary: "How exposed the customer side is to uncapped or asymmetric liability.",
    instructions: "How exposed is our counterparty-facing side to uncapped or asymmetric liability in `active_document.text`?",
    criteria: [
      "Liability is mutually capped at a reasonable, clearly stated amount",
      "Liability is capped, but only for one party or at an unusually high ceiling",
      "Liability is uncapped for at least one party, or the cap is vague",
    ],
    weight: 0.5,
  },
  indemnification_harshness: {
    label: "Indemnification harshness",
    summary: "How one-sided the indemnification obligation is.",
    instructions: "How one-sided is the indemnification obligation in `active_document.text`?",
    criteria: [
      "Indemnification is mutual and scoped to each party's own breaches",
      "Indemnification leans toward one party but has some carve-outs",
      "Indemnification is broad, one-sided, and covers third-party claims with no carve-outs",
    ],
    weight: 0.3,
  },
  termination_rigidity: {
    label: "Termination rigidity",
    summary: "How difficult it is to exit the agreement.",
    instructions: "How difficult is it to exit this agreement based on `active_document.text`?",
    criteria: [
      "Either party can terminate with reasonable notice and no penalty",
      "Termination is possible but requires cause, a long notice period, or a fee",
      "There is no practical termination-for-convenience path, or exit is heavily penalized",
    ],
    weight: 0.2,
  },
} as const;

export type RiskDimensionId = keyof typeof RISK_DIMENSIONS;

/** Overall-risk band edges, shared by the dashboard's coloring and the judge's evidence packet so they can never drift. */
export const RISK_BANDS = { moderateFrom: 0.33, highFrom: 0.66 } as const;
export type RiskBand = "low" | "moderate" | "high";
export const RISK_BAND_LABELS: Record<RiskBand, string> = { low: "Low risk", moderate: "Moderate risk", high: "High risk" };

/**
 * The band for an overall risk. It is taken from the figure as it is SHOWN (a whole percentage): a total of 0.655 is
 * displayed as 66%, so it must not be labelled with the band that 65.5% falls in while the text beside it says 66%.
 */
export function riskBand(overall: number): RiskBand {
  const shown = Math.round(overall * 100) / 100;
  return shown >= RISK_BANDS.highFrom ? "high" : shown >= RISK_BANDS.moderateFrom ? "moderate" : "low";
}

export const clauseRiskSkill: Skill<TurnContext> = {
  name: "clause_risk",
  description: "Scores contract risk across liability, indemnification, and termination, then combines them.",
  isApplicable: (ctx) => Boolean(ctx.session.activeDocument),
  buildQuestions(): Record<string, QuestionSpec> {
    const questions: Record<string, QuestionSpec> = {};
    for (const [id, dim] of Object.entries(RISK_DIMENSIONS)) {
      questions[id] = { type: "score", instructions: dim.instructions, criteria: [...dim.criteria] };
    }
    return questions;
  },
};

export interface CompositeRisk {
  overall: number; // 0..1, higher = riskier
  perDimension: { id: RiskDimensionId; label: string; normalized: number; confidence: number }[];
  lowestConfidence: number;
}

/** Normalizes each Score to 0..1 by its top level, then applies the weights owned in code above. */
export function computeCompositeRisk(answers: Record<string, Answer>): CompositeRisk | null {
  const ids = Object.keys(RISK_DIMENSIONS) as RiskDimensionId[];
  if (!ids.every((id) => answers[id]?.type === "score")) return null;

  let overall = 0;
  let lowestConfidence = 1;
  const perDimension = ids.map((id) => {
    const dim = RISK_DIMENSIONS[id];
    const answer = answers[id] as ScoreAnswer;
    const topLevel = dim.criteria.length - 1;
    const normalized = answer.score / topLevel;
    overall += normalized * dim.weight;
    lowestConfidence = Math.min(lowestConfidence, answer.confidence);
    return {
      id,
      label: dim.instructions,
      normalized: Math.round(normalized * 1000) / 1000,
      confidence: answer.confidence,
    };
  });

  return { overall: Math.round(overall * 1000) / 1000, perDimension, lowestConfidence };
}
