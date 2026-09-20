import type { QuestionSpec } from "./types";

/**
 * Exact UTF-8 size of what a TypeSafe call sends: the `state` and the question map (`Buffer.byteLength`, not
 * `.length`, since legal text has plenty of non-ASCII punctuation). This is the counterpart of the OpenAI client's
 * `requestBytes`, which measures its whole request body. Measuring the state alone would leave the questions out and
 * make the two backends' "in" sizes incomparable.
 */
export function typesafeRequestBytes(state: unknown, questions: Record<string, QuestionSpec>): number {
  return Buffer.byteLength(JSON.stringify({ state, questions }), "utf8");
}
