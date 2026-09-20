import type { OpenAIRunOutcome } from "./types";

/**
 * Why there is no OpenAI answer to evaluate, in words a reader can act on. The evaluation panel used to say "No answer
 * from this backend yet" for every case, which is wrong when the call failed or came back without the field: it will
 * never arrive, and the panel above was saying something different.
 *
 * Returns undefined while the answer is simply still on its way (or OpenAI isn't configured, which has its own message).
 */
export function noOpenAIAnswerReason(outcome: OpenAIRunOutcome | null, what: string): string | undefined {
  if (!outcome) return undefined;
  if (!outcome.ok) {
    return outcome.reason === "not_configured"
      ? undefined
      : "OpenAI's request failed, so there is no OpenAI answer to evaluate. The note above says why.";
  }
  return `OpenAI responded, but its answer did not include ${what}, so there is nothing to evaluate.`;
}
