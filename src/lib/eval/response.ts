import type { ActivityKind, ActivityRecord } from "../activity/log";
import type { EvalKind } from "./types";
import type { Backend } from "./store";

/**
 * What producing an answer cost: the time the model took to respond and what that call was billed, as measured for the
 * call (never the judge's own). `null` means no measurement exists, and is reported as "n/a", never as zero.
 */
export interface ResponseMetrics {
  ms: number | null;
  costUsd: number | null;
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

/** The latest written chat answer that came from this backend's findings. */
function latestWriter(records: readonly ActivityRecord[], backend: Backend): ActivityRecord | null {
  const name = backend === "typesafe" ? "TypeSafe" : "OpenAI";
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const r = records[i];
    if (r.actor === "writer" && r.status === "done" && r.label === `Answer from ${name}'s findings`) return r;
  }
  return null;
}

const addOrNull = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));

/**
 * The response time and cost behind the answer a scope is about to have judged, read from the session's activity log at
 * the moment the evaluation starts (the answer has just landed, so its call is the latest of its kind for that backend).
 *
 * One call answers both the risk and the compliance questions, and one batched call answers every citation check, so
 * those rows share their call's figures. The chat reply is the backend's findings call plus the model that wrote the
 * reply from them, so its figures are the two added together (when nothing wrote it, just the findings call).
 * Returns null when there is no measured call to read.
 */
export function responseFor(records: readonly ActivityRecord[], scope: string, kind: EvalKind | undefined, backend: Backend): ResponseMetrics | null {
  const call = latestMeasured(records, backend, producingKind(scope, kind));
  if (!call) return null;
  let metrics: ResponseMetrics = { ms: call.modelMs, costUsd: call.costUsd ?? null };
  if ((kind ?? scope.split(":")[0]) === "reply") {
    const writer = latestWriter(records, backend);
    if (writer) metrics = { ms: addOrNull(metrics.ms, writer.modelMs), costUsd: addOrNull(metrics.costUsd, writer.costUsd ?? null) };
  }
  return metrics;
}
