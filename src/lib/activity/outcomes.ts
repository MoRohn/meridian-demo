import type { OpenAIRunOutcome } from "../openai/types";
import { openaiCostUsd } from "../compare/openaiEquivalent";
import { typesafeCostUsd } from "../compare/pricing";
import type { TurnAnswer } from "../chat/answer";
import type { ActivityFinish } from "./log";

/** What to record when a TypeSafe call returns. The local demo heuristic answers on this machine, so it is timed but not counted as the model. */
export function typesafeActivityResult(
  source: "live" | "mock",
  elapsedMs: number,
  usage: { input_tokens: number; output_tokens: number },
): ActivityFinish {
  return {
    status: "done",
    modelMs: elapsedMs,
    model: source === "live" ? "jev" : "demo heuristic",
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    costUsd: typesafeCostUsd(source, usage),
    ...(source === "live" ? {} : { simulated: true }),
  };
}

/** What to record when an OpenAI comparison call comes back, whatever happened to it. */
export function openaiActivityResult(outcome: OpenAIRunOutcome | null | undefined): ActivityFinish {
  if (outcome?.ok) {
    const { model, usage, elapsedMs } = outcome.result;
    return { status: "done", modelMs: elapsedMs, model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, costUsd: openaiCostUsd(model, usage) };
  }
  // No key: nothing was called, so nothing is measured, and it is not a failure either.
  if (outcome?.reason === "not_configured") return { status: "done", simulated: true };
  return { status: "error", note: outcome?.message };
}

/** A written chat answer as an activity: timed on its own, and left out of both backends' speed and cost. Null when no model wrote it. */
export function writerActivityResult(answer: TurnAnswer | null | undefined): ActivityFinish | null {
  if (answer?.source !== "model") return null;
  return { status: "done", modelMs: answer.elapsedMs, model: answer.model, inputTokens: answer.usage?.input_tokens, outputTokens: answer.usage?.output_tokens, costUsd: answer.costUsd };
}

/**
 * The line under a chat reply saying where it came from, and a caution when the model that should have written it could
 * not. Templates need neither: they are Meridian's own wording, unchanged from before.
 */
export function describeAnswer(answer: TurnAnswer | null | undefined, backendName: string): { via: string | null; note: string | null } {
  if (!answer) return { via: null, note: null };
  const note = answer.note ?? null;
  if (answer.source === "model") return { via: `Written by ${answer.model ?? "the answer model"} from the document and ${backendName}'s findings`, note };
  if (answer.source === "document") return { via: "Quoted from the document. No answer model was used.", note };
  return { via: null, note };
}
