import { loadSettings, openaiOverride } from "@/lib/settings";
import type { EvalOutcome, EvalRequest } from "./types";

/** The OpenAI key saved in Settings, if any. Only the key is used: the judge has its own model, separate from the one chosen for chat. */
export function savedJudgeKey(): string | undefined {
  return openaiOverride(loadSettings())?.apiKey;
}

export async function runEvaluation(request: EvalRequest): Promise<EvalOutcome> {
  try {
    const apiKey = savedJudgeKey();
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Same convention as the app's other routes: a key saved in Settings travels with the request that needs it.
      body: JSON.stringify(apiKey ? { ...request, override: { apiKey } } : request),
    });
    const data = await res.json();
    return data.outcome as EvalOutcome;
  } catch (err) {
    return { ok: false, reason: "error", message: (err as Error).message };
  }
}
