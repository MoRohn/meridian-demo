/**
 * A normalized result from actually running the turn's questions through
 * OpenAI's chat-completions API with function calling — the real
 * counterpart to `src/lib/typesafe/types.ts#SystemOneResponse`, so the
 * Compare tab can show two genuinely-measured backends side by side instead
 * of one measurement and one estimate.
 */
export interface OpenAIFieldAnswer {
  /** The raw value the model chose for this question (a Choice option, a Score level index, or a boolean). */
  value: string | number | boolean;
  /** Self-reported by the model in the same tool call — NOT independently calibrated. See docs/architecture.md. */
  selfReportedConfidence: number | null;
}

export interface OpenAIRunResult {
  model: string;
  answers: Record<string, OpenAIFieldAnswer>;
  usage: { input_tokens: number; output_tokens: number };
  elapsedMs: number;
  source: "live";
  /** Set when the requested model was rejected (e.g. no account access yet) and this call transparently retried on a known-available model instead. */
  fallbackFrom?: string;
  /** Exact UTF-8 byte size of the JSON request body actually sent to OpenAI (system prompt + state + schema) — the real input footprint, not an estimate. */
  requestBytes: number;
}

/**
 * The reply Meridian's own pipeline composes from OpenAI's answers to a turn's questions: the same composer TypeSafe's
 * reply goes through, run on OpenAI's judgments, so the two replies can be evaluated like for like.
 */
export interface OpenAITurn {
  reply: string;
  intent: { choice: string; confidence: number } | null;
  risk: import("../skills/clauseRisk").CompositeRisk | null;
  complianceFlags: import("../orchestrator/compose").ComplianceFlag[];
  blocked: "privileged" | "injection" | null;
  /** Where `reply` came from, as for TypeSafe's turn. */
  answer?: import("../chat/answer").TurnAnswer;
}

export type OpenAIRunOutcome =
  | { ok: true; result: OpenAIRunResult }
  | { ok: false; reason: "not_configured" | "error"; message?: string };
