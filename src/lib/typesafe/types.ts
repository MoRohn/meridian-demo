/**
 * Minimal, JSON-serializable mirror of TypeSafe's Jev request/response
 * shapes (see https://docs.typesafe.ai/api). We model questions as plain
 * objects instead of the SDK's generic helpers because the orchestrator
 * assembles a different question set on every turn (speculative fan-out) —
 * a dynamic map is a better fit than statically-typed helpers here.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type State = JsonValue;

export interface ChoiceQuestionSpec {
  type: "choice";
  instructions: JsonValue;
  criteria: Record<string, JsonValue | null>;
}

export interface ScoreQuestionSpec {
  type: "score";
  instructions: JsonValue;
  criteria: JsonValue[];
}

export interface NoulQuestionSpec {
  type: "noul";
  instructions: JsonValue;
  criteria?: { true?: JsonValue; false?: JsonValue };
}

export type QuestionSpec = ChoiceQuestionSpec | ScoreQuestionSpec | NoulQuestionSpec;

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, JsonValue>;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export type Answer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
  /** Not part of the real API — added by our client wrapper so the UI can be honest about data provenance. */
  source: "live" | "mock";
  /** Wall-clock time for this call, measured client-side. Not part of the real API. */
  elapsedMs: number;
  /**
   * Set when a key was supplied but the demo heuristic answered anyway (the key was rejected, the call failed or timed out),
   * so a misconfiguration is not mistaken for the real model. Absent when there was simply no key. Not part of the real API.
   */
  fallbackReason?: string;
}

/**
 * A single "AI skill": a self-contained, named unit that proposes Jev
 * questions about the shared state and knows how to read its own answers back
 * out. This mirrors the plugin/function shape from frameworks like Microsoft
 * Semantic Kernel — a registry of small, independently testable capabilities
 * that an orchestrator composes at request time, rather than one monolithic
 * prompt.
 */
export interface Skill<TState = unknown> {
  name: string;
  description: string;
  /** If false, the skill's questions are omitted this turn (e.g. no document loaded yet). */
  isApplicable(state: TState): boolean;
  /** Every skill contributes to ONE shared Jev call — see patterns/fan-out. */
  buildQuestions(state: TState): Record<string, QuestionSpec>;
}
