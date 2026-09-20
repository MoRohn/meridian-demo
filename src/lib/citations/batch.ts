import { RELATION_CRITERIA, RELATION_TO_VERDICT, type CitationVerdict } from "../skills/citationVerifier";
import type { OpenAIFieldAnswer } from "../openai/types";
import type { Answer, QuestionSpec, State } from "../typesafe/types";

/**
 * All of a document's checks in ONE request per backend: the app's speculative fan-out pattern (docs.typesafe.ai/patterns/
 * fan-out). Each check is one Choice question over its own claim and source, addressed by id in the state, so a document with
 * a dozen checks costs one call to TypeSafe and one to OpenAI, not a dozen.
 */
export interface BatchCheck {
  id: string;
  claim: string;
  /** The text the claim is judged against. */
  source: string;
}

export type Relation = "supports" | "contradicts" | "says_nothing";
export const RELATION_LABELS: Record<Relation, string> = { supports: "supports", contradicts: "contradicts", says_nothing: "says nothing (silent)" };

export const questionId = (checkId: string) => `relation_${checkId}`;

export function buildBatch(checks: readonly BatchCheck[]): { state: State; questions: Record<string, QuestionSpec> } | null {
  if (checks.length === 0) return null;
  const state: Record<string, Record<string, { claim: string; source_section: string }>> = { checks: {} };
  const questions: Record<string, QuestionSpec> = {};
  for (const c of checks) {
    state.checks[c.id] = { claim: c.claim, source_section: c.source };
    questions[questionId(c.id)] = {
      type: "choice",
      instructions: `How does \`checks.${c.id}.source_section\` relate to \`checks.${c.id}.claim\`?`,
      criteria: RELATION_CRITERIA,
    };
  }
  return { state, questions };
}

/** One backend's answer to one check. */
export interface Judged {
  relation: Relation;
  verdict: Exclude<CitationVerdict, "fabricated">;
  /** 0..1. TypeSafe's is calibrated; OpenAI's is what it reported about itself. Null when OpenAI reported none. */
  confidence: number | null;
  basis: "calibrated" | "self-reported";
  probabilities?: Record<string, number>;
}

const isRelation = (x: unknown): x is Relation => x === "supports" || x === "contradicts" || x === "says_nothing";

export function judgedFromTypesafe(answers: Record<string, Answer>, checkIds: readonly string[]): Record<string, Judged> {
  const out: Record<string, Judged> = {};
  for (const id of checkIds) {
    const a = answers[questionId(id)];
    if (a?.type !== "choice" || !isRelation(a.choice)) continue;
    out[id] = { relation: a.choice, verdict: RELATION_TO_VERDICT[a.choice], confidence: a.confidence, basis: "calibrated", probabilities: a.probabilities };
  }
  return out;
}

export function judgedFromOpenAI(answers: Record<string, OpenAIFieldAnswer>, checkIds: readonly string[]): Record<string, Judged> {
  const out: Record<string, Judged> = {};
  for (const id of checkIds) {
    const a = answers[questionId(id)];
    const value = a ? String(a.value) : "";
    if (!isRelation(value)) continue;
    out[id] = { relation: value, verdict: RELATION_TO_VERDICT[value], confidence: a.selfReportedConfidence, basis: "self-reported" };
  }
  return out;
}
