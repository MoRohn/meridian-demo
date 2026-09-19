"use client";

import { useState } from "react";
import { runEvaluation } from "@/lib/eval/client";
import type { EvalOutcome } from "@/lib/eval/types";
import { RerunButton } from "./RerunButton";

function scoreTone(score: number): "emerald" | "amber" | "rose" {
  return score >= 0.8 ? "emerald" : score >= 0.6 ? "amber" : "rose";
}

const TONE_TEXT = { emerald: "text-emerald-700", amber: "text-amber-700", rose: "text-rose-700" } as const;
const TONE_RING = { emerald: "from-emerald-500", amber: "from-amber-500", rose: "from-rose-500" } as const;

function BackendEval({ name, outcome, pending }: { name: string; outcome: EvalOutcome | null; pending: boolean }) {
  if (pending) {
    return (
      <div className="rounded-lg border border-border bg-surface p-3">
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">{name}</p>
        <p className="text-sm font-medium text-muted">Judging…</p>
      </div>
    );
  }
  if (!outcome) {
    return (
      <div className="rounded-lg border border-border bg-surface p-3">
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">{name}</p>
        <p className="text-sm text-muted">Not evaluated yet.</p>
      </div>
    );
  }
  if (!outcome.ok) {
    return (
      <div className="rounded-lg border border-border bg-surface p-3">
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">{name}</p>
        <p className="text-sm text-muted">
          {outcome.reason === "not_configured" ? (outcome.message ?? "Eval service not configured.") : `Judge call failed: ${outcome.message}`}
        </p>
      </div>
    );
  }

  const tone = scoreTone(outcome.result.score);
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">{name}</p>
        <span className={`text-xs font-bold ${TONE_TEXT[tone]}`}>{outcome.result.success ? "PASS" : "FAIL"}</span>
      </div>
      <div className={`h-1 w-full bg-gradient-to-r ${TONE_RING[tone]} to-transparent`} />
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-2xl font-extrabold tracking-tight text-foreground">{Math.round(outcome.result.score * 100)}%</span>
        <span className="text-xs text-muted">judged by {outcome.result.judgeModel}</span>
      </div>
      <blockquote className="mt-2 border-l-2 border-border-strong pl-2 text-xs leading-relaxed text-secondary">
        {outcome.result.reason}
      </blockquote>
    </div>
  );
}

/**
 * A third, independent judgment layered on top of whatever TypeSafe and
 * OpenAI already answered — DeepEval's G-Eval (an LLM-as-judge metric)
 * scores each backend's actual output against a task-specific rubric and
 * writes out its chain-of-thought reasoning for the score. This is opt-in
 * per section (a real LLM call, with real latency and cost) rather than
 * automatic, so it never fires without the reader asking for it — see
 * eval-service/README.md for what has to be running for this to work.
 */
export function EvaluationPanel({
  task,
  criteria,
  input,
  context,
  typesafeOutput,
  openaiOutput,
  openaiConfigured,
}: {
  task: string;
  criteria: string;
  input: string;
  context?: string;
  /** The exact text summarizing TypeSafe's answer to judge; null when there's nothing to evaluate yet. */
  typesafeOutput: string | null;
  openaiOutput: string | null;
  openaiConfigured: boolean;
}) {
  const [tsOutcome, setTsOutcome] = useState<EvalOutcome | null>(null);
  const [oaOutcome, setOaOutcome] = useState<EvalOutcome | null>(null);
  const [tsPending, setTsPending] = useState(false);
  const [oaPending, setOaPending] = useState(false);

  async function run() {
    if (typesafeOutput) {
      setTsPending(true);
      runEvaluation({ task, backend: "typesafe", criteria, input, actualOutput: typesafeOutput, context })
        .then(setTsOutcome)
        .finally(() => setTsPending(false));
    }
    if (openaiOutput && openaiConfigured) {
      setOaPending(true);
      runEvaluation({ task, backend: "openai", criteria, input, actualOutput: openaiOutput, context })
        .then(setOaOutcome)
        .finally(() => setOaPending(false));
    }
  }

  const hasAnything = typesafeOutput || openaiOutput;
  const hasRun = tsOutcome || oaOutcome;

  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-elevated/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
          <span aria-hidden>🧪</span> DeepEval (G-Eval)
        </p>
        {hasAnything && (
          <RerunButton onClick={run} pending={tsPending || oaPending} label={hasRun ? "Re-evaluate" : "Evaluate"} />
        )}
      </div>
      {hasRun && (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          <BackendEval name="TypeSafe" outcome={tsOutcome} pending={tsPending} />
          <BackendEval name="OpenAI" outcome={oaOutcome} pending={oaPending} />
        </div>
      )}
    </div>
  );
}
