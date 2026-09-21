import type { EvalKind } from "./types";

/** One rubric as the evaluation service defines it (eval-service/rubrics.py), for the "Scoring Rubric" view. */
export interface RubricInfo {
  id: EvalKind;
  version: string;
  title: string;
  /** What the judge is asked to judge, in one sentence. */
  taskLine: string;
  /** The fixed steps the judge follows, verbatim and in order. */
  steps: string[];
  /** A short label and one-line summary for each step, in the same order, for reading. Empty when the service sent none that line up with the steps. */
  outline: { label: string; summary: string }[];
  /** Score bands over 0-10, covering the scale and split exactly at the pass mark. */
  bands: { low: number; high: number; outcome: string }[];
  /** 0..1: the score at or above which an answer passes. */
  passThreshold: number;
}

/** The order rubrics are shown in when there is more than one. */
export const RUBRIC_ORDER: readonly EvalKind[] = ["risk", "compliance", "citation", "reply"];

/** Which rubrics each analysis tab's "Scoring Rubric" button shows. The Trace tab judges the chat reply and compares every capability, so it shows them all. */
export function rubricsForTab(tab: EvalKind | "trace"): readonly EvalKind[] {
  return tab === "trace" ? RUBRIC_ORDER : [tab];
}

const isString = (x: unknown): x is string => typeof x === "string" && x.length > 0;

/** Reads the service's /rubrics payload, dropping anything malformed instead of throwing. Null when nothing usable came back. */
export function parseRubrics(payload: unknown): RubricInfo[] | null {
  if (!payload || typeof payload !== "object") return null;
  const out: RubricInfo[] = [];
  for (const id of RUBRIC_ORDER) {
    const r = (payload as Record<string, unknown>)[id] as Record<string, unknown> | undefined;
    if (!r || typeof r !== "object" || !isString(r.version) || !isString(r.title) || !Array.isArray(r.steps)) continue;
    const steps = r.steps.filter(isString);
    if (steps.length === 0) continue;
    const bands = (Array.isArray(r.bands) ? r.bands : [])
      .filter((b): b is { low: number; high: number; outcome: string } => Boolean(b) && typeof b.low === "number" && typeof b.high === "number" && isString(b.outcome));
    const rawOutline = (Array.isArray(r.outline) ? r.outline : []) as Record<string, unknown>[];
    const outline = rawOutline.filter((o) => o && isString(o.label) && isString(o.summary)).map((o) => ({ label: o.label as string, summary: o.summary as string }));
    out.push({
      id,
      version: r.version,
      title: r.title,
      taskLine: isString(r.task_line) ? r.task_line : "",
      steps,
      // Only trusted when there is one entry per step: an outline that does not line up would label the wrong steps.
      outline: outline.length === steps.length && rawOutline.length === steps.length ? outline : [],
      bands,
      passThreshold: typeof r.pass_threshold === "number" ? r.pass_threshold : 0.6,
    });
  }
  return out.length ? out : null;
}
