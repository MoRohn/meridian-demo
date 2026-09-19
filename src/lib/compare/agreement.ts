import type { Answer } from "../typesafe/types";
import type { OpenAIFieldAnswer, OpenAIRunOutcome } from "../openai/types";
import type { TraceEntry } from "../orchestrator/run";

/**
 * The shared building block for showing both backends' answers on the same
 * judgment side by side — used by the Reasoning Trace, Risk, and Compliance
 * tabs, instead of one separate "Compare" destination. Every tab that shows
 * a TypeSafe judgment shows OpenAI's for the identical question right next
 * to it, when that comparison has run.
 */
export function openaiAnswerFor(outcome: OpenAIRunOutcome | null, questionId: string): OpenAIFieldAnswer | null {
  if (!outcome?.ok) return null;
  return outcome.result.answers[questionId] ?? null;
}

export function agrees(answer: Answer, value: string | number | boolean): boolean {
  if (answer.type === "noul") return answer.noul >= 0.5 === Boolean(value);
  if (answer.type === "choice") return answer.choice === String(value);
  return Math.round(answer.score) === Number(value);
}

export function typesafeSummary(answer: Answer): { label: string; confidence: number | null } {
  if (answer.type === "noul") return { label: answer.noul >= 0.5 ? "yes" : "no", confidence: null };
  if (answer.type === "choice") return { label: answer.choice, confidence: answer.confidence };
  return { label: `level ${Math.round(answer.score)}`, confidence: answer.confidence };
}

/**
 * How often TypeSafe and OpenAI landed on the same answer for the same
 * question, across every entry a trace has both sides for — the headline
 * number the Trace tab's summary bar leads with. `compared` only counts
 * questions OpenAI actually answered, so a missing/not-configured OpenAI
 * side never drags the rate down.
 */
export function agreementSummary(trace: TraceEntry[], outcome: OpenAIRunOutcome | null): { agreed: number; compared: number } {
  let agreed = 0;
  let compared = 0;
  for (const entry of trace) {
    const oa = openaiAnswerFor(outcome, entry.questionId);
    if (!oa) continue;
    compared += 1;
    if (agrees(entry.answer, oa.value)) agreed += 1;
  }
  return { agreed, compared };
}
