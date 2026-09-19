import { systemOne, type KeyOverride } from "../typesafe/client";
import type { ChoiceAnswer, QuestionSpec, State } from "../typesafe/types";

/**
 * Double-checking citations (docs.typesafe.ai/cookbooks/citation_check).
 *
 * This is deliberately NOT folded into the orchestrator's single fan-out
 * call, and that's the point to call out: composing every question into one
 * request is the default (see patterns/fan-out), but here code genuinely
 * needs the first step's result — which authority section the quote lives
 * in — before it can ask the second question at all. A plain substring
 * match (free, instant, no model needed) does that lookup; only a quote
 * that survives it is worth spending a judgment on.
 */

export type CitationVerdict = "verified" | "unsupported" | "contradicted" | "fabricated";

export interface CitationCheckResult {
  status: "found" | "missing" | "section-only";
  sectionId: string | null;
  sectionText: string | null;
  relation: { choice: string; probabilities: Record<string, number>; confidence: number } | null;
  verdict: CitationVerdict;
  autoAccept: boolean;
  /** Real measured latency; 0 for a fabricated quote, since no model call was made. */
  elapsedMs: number;
  /** Real input/output token usage for this check; zero for a fabricated quote (no model call). */
  usage: { input_tokens: number; output_tokens: number };
  /** Exact UTF-8 byte size of the `{ claim, source_section }` state actually sent to Jev. */
  inputBytes: number;
}

const AUTO_ACCEPT = 0.75;

function normalize(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function locate(
  authorities: Record<string, string>,
  quote: string | null,
  namedSectionId?: string
): { status: CitationCheckResult["status"]; sectionId: string | null; sectionText: string | null } {
  if (!quote) {
    if (namedSectionId && authorities[namedSectionId]) {
      return { status: "section-only", sectionId: namedSectionId, sectionText: authorities[namedSectionId] };
    }
    return { status: "missing", sectionId: null, sectionText: null };
  }
  const needle = normalize(quote);
  for (const [id, text] of Object.entries(authorities)) {
    if (normalize(text).includes(needle)) {
      return { status: "found", sectionId: id, sectionText: text };
    }
  }
  return { status: "missing", sectionId: null, sectionText: null };
}

const RELATION_TO_VERDICT: Record<string, CitationVerdict> = {
  supports: "verified",
  contradicts: "contradicted",
  says_nothing: "unsupported",
};

export const RELATION_QUESTIONS: Record<string, QuestionSpec> = {
  relation: {
    type: "choice",
    instructions: "How does `source_section` relate to `claim`?",
    criteria: {
      supports: "The section states the claim or directly implies it is true",
      contradicts: "The section states the opposite of the claim or implies it is false",
      says_nothing: "The section does not address what the claim asserts, either way",
    },
  },
};

export type RelationRequest =
  | { status: "missing" }
  | {
      status: "found" | "section-only";
      sectionId: string;
      sectionText: string;
      state: State;
      questions: typeof RELATION_QUESTIONS;
    };

/**
 * The locate-then-ask setup shared by both the real citation check (below,
 * against TypeSafe) and the OpenAI comparison route
 * (/api/compare-openai-citation) — identical state and questions to either
 * backend, same as the chat turn's buildTurnRequest.
 */
export function buildRelationRequest(
  authorities: Record<string, string>,
  claim: string,
  quote: string | null,
  namedSectionId?: string
): RelationRequest {
  const located = locate(authorities, quote, namedSectionId);
  if (located.status === "missing" || !located.sectionText || !located.sectionId) {
    return { status: "missing" };
  }
  return {
    status: located.status,
    sectionId: located.sectionId,
    sectionText: located.sectionText,
    state: { claim, source_section: located.sectionText },
    questions: RELATION_QUESTIONS,
  };
}

export async function verifyCitation(
  authorities: Record<string, string>,
  claim: string,
  quote: string | null,
  namedSectionId?: string,
  override?: KeyOverride
): Promise<CitationCheckResult> {
  const request = buildRelationRequest(authorities, claim, quote, namedSectionId);

  if (request.status === "missing") {
    return {
      status: "missing",
      sectionId: null,
      sectionText: null,
      relation: null,
      verdict: "fabricated",
      autoAccept: true,
      elapsedMs: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
      inputBytes: 0,
    };
  }

  const response = await systemOne(request.state, request.questions, override);

  const answer = response.answers.relation as ChoiceAnswer;
  return {
    status: request.status,
    sectionId: request.sectionId,
    sectionText: request.sectionText,
    relation: { choice: answer.choice, probabilities: answer.probabilities, confidence: answer.confidence },
    verdict: RELATION_TO_VERDICT[answer.choice] ?? "unsupported",
    autoAccept: answer.confidence >= AUTO_ACCEPT,
    elapsedMs: response.elapsedMs,
    usage: response.usage,
    inputBytes: Buffer.byteLength(JSON.stringify(request.state), "utf8"),
  };
}
