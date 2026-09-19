import type { EvalOutcome } from "./types";

/**
 * One structured log line per evaluation request, for whoever runs the app. It carries what monitoring needs (what was
 * judged, how it ended, how long it took) and never the text that was judged: that is confidential contract content.
 */
export function evalLogLine(args: { kind: string; backend: string; outcome: EvalOutcome; ms: number }): string {
  const { kind, backend, outcome, ms } = args;
  return JSON.stringify({
    evt: "eval",
    kind,
    backend,
    ok: outcome.ok,
    ...(outcome.ok
      ? { score: Number(outcome.result.score.toFixed(2)), success: outcome.result.success, rubric: `${outcome.result.rubric.id}@${outcome.result.rubric.version}`, integrity: outcome.result.integrity.status, judgeMs: outcome.result.latencyMs }
      : { reason: outcome.reason, code: outcome.code ?? null }),
    ms,
  });
}
