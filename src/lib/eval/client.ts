import type { EvalOutcome, EvalRequest } from "./types";

export async function runEvaluation(request: EvalRequest): Promise<EvalOutcome> {
  try {
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const data = await res.json();
    return data.outcome as EvalOutcome;
  } catch (err) {
    return { ok: false, reason: "error", message: (err as Error).message };
  }
}
