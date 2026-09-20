import type { ChoiceQuestionSpec } from "../typesafe/types";

/**
 * How a source is judged against a claim (docs.typesafe.ai/cookbooks/citation_check): a Choice over three relations, which
 * maps to a verdict. The lookup step (which text is the source) is done by code before any model is asked, in
 * src/lib/citations/extract.ts; this file is only the question and how its answer is read.
 */
export type CitationVerdict = "verified" | "unsupported" | "contradicted" | "fabricated";

/** A verdict is auto-accepted when the model's confidence in its relation answer reaches this. */
export const AUTO_ACCEPT = 0.75;

export const RELATION_TO_VERDICT: Record<string, Exclude<CitationVerdict, "fabricated">> = {
  supports: "verified",
  contradicts: "contradicted",
  says_nothing: "unsupported",
};

export const RELATION_CRITERIA: ChoiceQuestionSpec["criteria"] = {
  supports: "The section states the claim or directly implies it is true",
  contradicts: "The section states the opposite of the claim or implies it is false",
  says_nothing: "The section does not address what the claim asserts, either way",
};
