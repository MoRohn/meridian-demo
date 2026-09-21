import { wallOf, type ActivityKind, type ActivityRecord } from "../activity/log";
import type { EvalKind } from "./types";
import type { Backend } from "./store";

/**
 * What producing an answer took and cost, as measured for the call (never the judge's own). `null` means no measurement
 * exists, and is reported as "n/a", never as zero.
 *
 * Three time figures and three cost figures, named as everywhere else in the app: the *model total* (what the turn took
 * from send to the answer landing), the model's own *reasoning* (its judgments call), and the *LLM response* (the model
 * that wrote the reply). `ms` and `costUsd` are the totals.
 */
export interface ResponseMetrics {
  /** Model total time. */
  ms: number | null;
  reasoningMs: number | null;
  /** The LLM response. Null when no model wrote the answer being judged. */
  writingMs: number | null;
  /** Total cost: reasoning plus LLM response. */
  costUsd: number | null;
  reasoningCostUsd: number | null;
  writingCostUsd: number | null;
}

/** The kind of model call that produces the answer behind an evaluation surface. */
function producingKind(scope: string, kind: EvalKind | undefined): ActivityKind {
  const [base, suffix] = scope.split(":");
  if (suffix === "excerpt") return "excerpt";
  return (kind ?? base) === "citation" ? "citation" : "chat";
}

/** The latest call of this backend that finished with a real measurement: not running, not failed, not the local demo heuristic. */
function latestMeasured(records: readonly ActivityRecord[], actor: ActivityRecord["actor"], kind: ActivityKind): ActivityRecord | null {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const r = records[i];
    if (r.actor === actor && r.kind === kind && r.status === "done" && !r.simulated && r.modelMs != null) return r;
  }
  return null;
}

const addOrNull = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));

/**
 * The time and cost behind the answer a scope is about to have judged, read from the session's activity log at the moment
 * the evaluation starts (the answer has just landed, so its call is the latest of its kind for that backend).
 *
 * The chat reply is the one answer that is the whole turn: the backend's reasoning call, then the model that wrote the reply
 * from it, so its total is the turn's time to answer and its cost is reasoning plus LLM response. Every other judged answer
 * (Risk, Compliance, an excerpt scan, the citation checks) is the backend's reasoning output itself, so its total is its
 * reasoning and it has no LLM response. One call answers both Risk and Compliance, and one batched call answers every
 * citation check, so those rows share their call's figures. Returns null when there is no measured call to read.
 */
export function responseFor(records: readonly ActivityRecord[], scope: string, kind: EvalKind | undefined, backend: Backend): ResponseMetrics | null {
  const call = latestMeasured(records, backend, producingKind(scope, kind));
  if (!call) return null;
  const reasoningCostUsd = call.costUsd ?? null;
  if ((kind ?? scope.split(":")[0]) === "reply" && call.kind === "chat") {
    const writingCostUsd = call.answerCostUsd ?? null;
    return {
      ms: wallOf(call, 0),
      reasoningMs: call.modelMs,
      writingMs: call.answerMs ?? null,
      costUsd: addOrNull(reasoningCostUsd, writingCostUsd),
      reasoningCostUsd,
      writingCostUsd,
    };
  }
  return { ms: call.modelMs, reasoningMs: call.modelMs, writingMs: null, costUsd: reasoningCostUsd, reasoningCostUsd, writingCostUsd: null };
}
