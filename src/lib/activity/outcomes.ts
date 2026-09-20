import type { OpenAIRunOutcome } from "../openai/types";
import { openaiCostUsd } from "../compare/openaiEquivalent";
import { typesafeCostUsd } from "../compare/pricing";
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
