import type { TurnAnswer } from "./chat/answer";

/** What the model call that wrote a chat reply took in and produced. Separate from the judgments call, but part of the same turn. */
export interface AnswerCallMetrics {
  model: string;
  inputBytes: number;
  inputTokens: number;
  outputTokens: number;
}

export interface Tally {
  inputBytes: number;
  inputTokens: number;
  outputTokens: number;
}

/** The reply-writing call's measurements, or undefined when no model wrote the reply (document quotes, templates, a failed call). */
export function answerCallMetrics(answer: TurnAnswer | null | undefined): AnswerCallMetrics | undefined {
  if (!answer || answer.source !== "model" || !answer.usage) return undefined;
  return {
    model: answer.model ?? "",
    inputBytes: answer.inputBytes ?? 0,
    inputTokens: answer.usage.input_tokens,
    outputTokens: answer.usage.output_tokens,
  };
}

/** Everything one backend put through models for an action: the judgments call plus, when there was one, the call that wrote the reply. */
export function totalTally(judgments: Tally, answer?: AnswerCallMetrics): Tally {
  return {
    inputBytes: judgments.inputBytes + (answer?.inputBytes ?? 0),
    inputTokens: judgments.inputTokens + (answer?.inputTokens ?? 0),
    outputTokens: judgments.outputTokens + (answer?.outputTokens ?? 0),
  };
}
