/**
 * A THIRD, independent judgment on top of TypeSafe's and OpenAI's own
 * answers — not a re-measurement of calibrated confidence or self-reported
 * confidence (those describe how sure the ANSWERING model was), but an
 * LLM-as-judge (DeepEval's G-Eval: https://github.com/confident-ai/deepeval)
 * scoring whether that answer was actually good against a task-specific
 * rubric, with a written chain-of-thought reason. See eval-service/main.py.
 */
export interface EvalRequest {
  /** Which Meridian capability this judges — "Composite risk", "Compliance flags", "Citation verdict", "Chat reply", ... */
  task: string;
  backend: "typesafe" | "openai";
  /** The natural-language rubric G-Eval scores against. */
  criteria: string;
  input: string;
  actualOutput: string;
  context?: string;
}

export interface EvalResult {
  /** 0..1, G-Eval's own scale. */
  score: number;
  /** The chain-of-thought explanation for the score — the actual point of running this. */
  reason: string;
  /** Whether score cleared the service's success threshold (0.6). */
  success: boolean;
  judgeModel: string;
}

export type EvalOutcome =
  | { ok: true; result: EvalResult }
  | { ok: false; reason: "not_configured" | "error"; message?: string };
