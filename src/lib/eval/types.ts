/**
 * A THIRD, independent judgment on top of TypeSafe's and OpenAI's own
 * answers — not a re-measurement of calibrated confidence or self-reported
 * confidence (those describe how sure the ANSWERING model was), but an
 * LLM-as-judge (DeepEval's G-Eval: https://github.com/confident-ai/deepeval)
 * scoring whether that answer was actually good against a task-specific
 * rubric, with a written chain-of-thought reason. See eval-service/main.py.
 */
export type EvalKind = "risk" | "compliance" | "citation" | "reply";

export interface EvalRequest {
  /** Which Meridian capability this judges; selects the service's versioned rubric. */
  kind: EvalKind;
  backend: "typesafe" | "openai";
  /** What the system was asked — see src/lib/eval/packets.ts for the standardized formats. */
  input: string;
  actualOutput: string;
  /** The source text the answer must be supported by. */
  context?: string;
  /** The judge chosen in Settings, forwarded for this one request: its key, and optionally which company's model and which model. Never stored server-side. */
  override?: { apiKey?: string; provider?: "openai" | "anthropic" | "gemini"; model?: string };
}

export interface EvalIntegrity {
  /** "suspicious" means text in the request looked like an attempt to steer the judge; the judge was told to ignore it, but a human should look. */
  status: "clean" | "suspicious";
  signals: { field: string; signal: string }[];
  hiddenCharsRemoved: number;
}

export interface EvalResult {
  /** 0..1, G-Eval's own scale. */
  score: number;
  /** The judge's written explanation for the score. */
  reason: string;
  /** Whether score cleared the pass threshold. */
  success: boolean;
  threshold: number;
  judgeModel: string;
  /** Which versioned rubric graded this — scores are only comparable within one version. */
  rubric: { id: string; version: string; title: string };
  /** The fixed evaluation steps the judge scored against, verbatim. */
  steps: string[];
  /** The rubric's score bands over 0-10, so a score can be read as what it means. */
  bands: { low: number; high: number; outcome: string }[];
  integrity: EvalIntegrity;
  latencyMs: number;
  /** What the judge call itself cost in USD, or null when it could not be priced. */
  judgeCostUsd: number | null;
}

export type EvalOutcome =
  | { ok: true; result: EvalResult }
  | { ok: false; reason: "not_configured" | "error"; message?: string; /** Stable failure code from the eval service, e.g. "judge_rate_limited". */ code?: string };
