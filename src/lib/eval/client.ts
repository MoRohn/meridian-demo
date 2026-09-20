import { judgeOverride, loadSettings, type JudgeOverride } from "@/lib/settings";
import type { EvalOutcome, EvalRequest } from "./types";

/**
 * The judge chosen in Settings, if any: by default the saved OpenAI key alone (the service picks its own judge model), or
 * the provider, model and key picked under "Judge model". This is the one place a key for judging is read from; there is no
 * other way to give the judge a key from the app.
 */
export function savedJudge(): JudgeOverride | undefined {
  return judgeOverride(loadSettings());
}

/** Whether Settings holds a key for the chosen judge. */
export function savedJudgeKey(): string | undefined {
  return savedJudge()?.apiKey;
}

export async function runEvaluation(request: EvalRequest): Promise<EvalOutcome> {
  try {
    const judge = savedJudge();
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Same convention as the app's other routes: what is saved in Settings travels with the request that needs it.
      body: JSON.stringify(judge ? { ...request, override: judge } : request),
    });
    const data = await res.json();
    return data.outcome as EvalOutcome;
  } catch (err) {
    return { ok: false, reason: "error", message: (err as Error).message };
  }
}
