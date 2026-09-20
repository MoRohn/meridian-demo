import type { ActivityRecord } from "../activity/log";
import { elapsedOf, formatElapsed } from "../activity/log";
import type { StoredEvaluationRow } from "../eval/store";
import type { EvalKind, EvalResult } from "../eval/types";
import { fmtUsd } from "./pricing";

/**
 * Cross-model performance, computed from what was actually measured this session: the activity log (speed, tokens, cost,
 * failures) and the independent judge's scores (quality). Nothing here is estimated or invented; a figure with no data
 * behind it is null and shown as "n/a", never as zero.
 */
export type Backend = "typesafe" | "openai";
export const BACKENDS: readonly Backend[] = ["typesafe", "openai"];
export const BACKEND_NAMES: Record<Backend, string> = { typesafe: "TypeSafe", openai: "OpenAI" };

export interface LatencyStats {
  n: number;
  min: number;
  median: number;
  mean: number;
  p95: number;
  max: number;
  last: number;
}

export interface QualityStats {
  evaluated: number;
  passed: number;
  /** Mean 0..1 judge score, or null when nothing was evaluated. */
  meanScore: number | null;
  passRate: number | null;
  byKind: Partial<Record<EvalKind, { n: number; meanScore: number }>>;
}

export interface BackendPerformance {
  backend: Backend;
  calls: number;
  failures: number;
  latency: LatencyStats | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  quality: QualityStats;
  /** Spend per judged-and-passed answer: what a trustworthy answer cost. Null until one has passed. */
  costPerPass: number | null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Nearest-rank percentile of a list already sorted ascending. */
function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

export function latencyStats(times: number[], last: number): LatencyStats | null {
  if (times.length === 0) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    n: sorted.length,
    min: sorted[0],
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    mean: sum(sorted) / sorted.length,
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    last,
  };
}

export function summarizeBackend(backend: Backend, records: readonly ActivityRecord[], evals: readonly StoredEvaluationRow[]): BackendPerformance {
  const mine = records.filter((r) => r.actor === backend && r.status !== "pending" && !r.simulated);
  const ok = mine.filter((r) => r.status === "done");
  // A call that never reached a model (a fabricated citation quote is rejected locally, in 0 ms) is not a speed sample.
  const timed = ok.filter((r) => (r.modelMs ?? 1) > 0);
  const latency = latencyStats(timed.map((r) => elapsedOf(r, 0)), timed.length ? elapsedOf(timed[timed.length - 1], 0) : 0);

  const scored = evals.filter((e) => e.backend === backend && e.outcome?.ok);
  const results = scored.map((e) => ({ kind: e.kind, result: (e.outcome as { ok: true; result: EvalResult }).result }));
  const passed = results.filter((r) => r.result.success).length;
  const byKind: QualityStats["byKind"] = {};
  for (const { kind, result } of results) {
    if (!kind) continue;
    const slot = byKind[kind] ?? { n: 0, meanScore: 0 };
    slot.meanScore = (slot.meanScore * slot.n + result.score) / (slot.n + 1);
    slot.n += 1;
    byKind[kind] = slot;
  }
  const costUsd = sum(ok.map((r) => r.costUsd ?? 0));
  return {
    backend,
    calls: mine.length,
    failures: mine.length - ok.length,
    latency,
    inputTokens: sum(ok.map((r) => r.inputTokens ?? 0)),
    outputTokens: sum(ok.map((r) => r.outputTokens ?? 0)),
    costUsd,
    quality: {
      evaluated: results.length,
      passed,
      meanScore: results.length ? sum(results.map((r) => r.result.score)) / results.length : null,
      passRate: results.length ? passed / results.length : null,
      byKind,
    },
    costPerPass: passed > 0 ? costUsd / passed : null,
  };
}

// ---- head to head --------------------------------------------------------

export type Edge = Backend | "tie" | "n/a";

export interface Dimension {
  id: "quality" | "speed" | "cost" | "reliability";
  label: string;
  edge: Edge;
  /** One plain sentence with the numbers behind the edge. */
  detail: string;
}

/** Differences smaller than this are noise, not an edge: 3 score points, 10% in speed, 5% in cost. */
const TIE = { speed: 0.1, cost: 0.05 };
/** Judge scores within this many points of each other are level. */
export const TIE_POINTS = 3;

/**
 * Head to head on two scores as the reader sees them: whole percents, and the gap between those. Working in whole points
 * (not by subtracting the raw floats) is what makes "within 3 points" mean 3 points: 0.63 - 0.60 is 0.030000000000000027
 * as a float, which would otherwise miss a 3-point tie that the text describes as one.
 */
export function compareScores(ts: number, oa: number): { delta: number; winner: Edge } {
  const delta = Math.round(ts * 100) - Math.round(oa * 100);
  return { delta, winner: Math.abs(delta) <= TIE_POINTS ? "tie" : delta > 0 ? "typesafe" : "openai" };
}

function edgeLowerIsBetter(ts: number | null, oa: number | null, tolerance: number): Edge {
  if (ts == null || oa == null) return "n/a";
  const hi = Math.max(ts, oa);
  if (hi === 0 || Math.abs(ts - oa) / hi <= tolerance) return "tie";
  return ts < oa ? "typesafe" : "openai";
}

const ratio = (big: number, small: number) => (small > 0 ? `${(big / small).toFixed(1)}×` : "");
const pctText = (x: number) => `${Math.round(x * 100)}%`;

export function compareBackends(ts: BackendPerformance, oa: BackendPerformance): Dimension[] {
  const dims: Dimension[] = [];

  const [tq, oq] = [ts.quality.meanScore, oa.quality.meanScore];
  if (tq == null || oq == null) {
    dims.push({ id: "quality", label: "Quality", edge: "n/a", detail: "Needs an evaluation of both models' answers." });
  } else {
    const { delta, winner: edge } = compareScores(tq, oq);
    dims.push({
      id: "quality",
      label: "Quality",
      edge,
      detail:
        `Judge score ${pctText(tq)} vs ${pctText(oq)} over ${
          ts.quality.evaluated === oa.quality.evaluated
            ? `${ts.quality.evaluated} evaluation${ts.quality.evaluated === 1 ? "" : "s"} each`
            : `${ts.quality.evaluated} and ${oa.quality.evaluated} evaluations`
        }` +
        (edge === "tie" ? ", within noise." : `, ${Math.abs(delta)} points apart.`),
    });
  }

  const [tl, ol] = [ts.latency?.median ?? null, oa.latency?.median ?? null];
  const speedEdge = edgeLowerIsBetter(tl, ol, TIE.speed);
  dims.push({
    id: "speed",
    label: "Speed",
    edge: speedEdge,
    detail:
      tl == null || ol == null
        ? "Needs a completed call from both models."
        : `Median ${formatElapsed(tl)} vs ${formatElapsed(ol)}` +
          (speedEdge === "tie" ? ", within noise." : `, ${speedEdge === "typesafe" ? ratio(ol, tl) : ratio(tl, ol)} faster.`) +
          ` Slowest call ${formatElapsed(ts.latency!.max)} vs ${formatElapsed(oa.latency!.max)}.`,
  });

  const [tOk, oOk] = [ts.calls - ts.failures, oa.calls - oa.failures]; // a failed call is not billed, so it is not in the average
  const [tc, oc] = tOk > 0 && oOk > 0 ? [ts.costUsd / tOk, oa.costUsd / oOk] : [null, null];
  const costEdge = edgeLowerIsBetter(tc, oc, TIE.cost);
  dims.push({
    id: "cost",
    label: "Cost",
    edge: costEdge,
    detail:
      tc == null || oc == null
        ? "Needs a completed call from both models."
        : `${fmtUsd(tc)} vs ${fmtUsd(oc)} per call` +
          (costEdge === "tie" || tc === 0 || oc === 0 ? "" : `, ${costEdge === "typesafe" ? ratio(oc, tc) : ratio(tc, oc)} cheaper`) +
          (ts.costPerPass != null && oa.costPerPass != null ? `; per passing answer ${fmtUsd(ts.costPerPass)} vs ${fmtUsd(oa.costPerPass)}.` : "."),
  });

  const [tf, of] = [ts.calls ? ts.failures / ts.calls : null, oa.calls ? oa.failures / oa.calls : null];
  const relEdge: Edge = tf == null || of == null ? "n/a" : tf === of ? "tie" : tf < of ? "typesafe" : "openai";
  dims.push({
    id: "reliability",
    label: "Reliability",
    edge: relEdge,
    detail:
      tf == null || of == null
        ? "Needs a completed call from both models."
        : `TypeSafe failed ${ts.failures} of ${ts.calls} calls; OpenAI ${oa.failures} of ${oa.calls}.`,
  });
  return dims;
}

/**
 * The plain-language conclusion: who leads on what, and what it costs to choose. Deliberately cautious about sample
 * size, because two or three judged answers can point either way.
 */
export function performanceVerdict(dims: Dimension[], ts: BackendPerformance, oa: BackendPerformance): string {
  const known = dims.filter((d) => d.edge !== "n/a");
  if (known.length === 0) return "Run the same action on both models and let the judge score them to see how they compare.";
  const wins = (b: Backend) => known.filter((d) => d.edge === b);
  const names = (b: Backend) => wins(b).map((d) => d.label.toLowerCase()).join(", ");
  const parts: string[] = [];
  if (wins("typesafe").length) parts.push(`TypeSafe leads on ${names("typesafe")}`);
  if (wins("openai").length) parts.push(`OpenAI leads on ${names("openai")}`);
  const ties = known.filter((d) => d.edge === "tie").map((d) => d.label.toLowerCase());
  if (ties.length) parts.push(`${parts.length ? "they are level on" : "The models are level on"} ${ties.join(", ")}`);
  let text = parts.join("; ") + ".";
  const quality = dims.find((d) => d.id === "quality");
  if (quality && quality.edge !== "n/a" && quality.edge !== "tie") {
    const other = quality.edge === "typesafe" ? "openai" : "typesafe";
    if (wins(other).some((d) => d.id !== "quality")) text += ` Quality is the difference that matters for a contract review; the other gaps are trade-offs.`;
  }
  const samples = Math.min(ts.quality.evaluated, oa.quality.evaluated);
  if (samples > 0 && samples < 5) text += ` Based on ${samples} judged answer${samples === 1 ? "" : "s"} per model, so treat it as indicative.`;
  return text;
}

// ---- matchups: the same action, judged on both models ----------------------

export interface Matchup {
  scope: string;
  kind: EvalKind | undefined;
  typesafe: EvalResult;
  openai: EvalResult;
  /** typesafe minus openai, in score points (-100..100). */
  delta: number;
  winner: Edge;
}

/** Every action both models were judged on, side by side. */
export function matchups(evals: readonly StoredEvaluationRow[]): Matchup[] {
  const byScope = new Map<string, Partial<Record<Backend, StoredEvaluationRow>>>();
  for (const e of evals) {
    if (!e.outcome?.ok) continue;
    byScope.set(e.scope, { ...byScope.get(e.scope), [e.backend]: e });
  }
  const out: Matchup[] = [];
  for (const [scope, pair] of byScope) {
    if (!pair.typesafe || !pair.openai) continue;
    const t = (pair.typesafe.outcome as { ok: true; result: EvalResult }).result;
    const o = (pair.openai.outcome as { ok: true; result: EvalResult }).result;
    const { delta, winner } = compareScores(t.score, o.score);
    out.push({ scope, kind: pair.typesafe.kind ?? pair.openai.kind, typesafe: t, openai: o, delta, winner });
  }
  return out;
}

/** One sentence on how two judged answers to the same request compare, for the evaluation panel. */
export function describeMatchup(m: Pick<Matchup, "typesafe" | "openai" | "delta" | "winner">): string {
  const t = Math.round(m.typesafe.score * 100);
  const o = Math.round(m.openai.score * 100);
  if (m.winner === "tie") return `Level: ${t}% and ${o}% are within ${TIE_POINTS} points, which is within judge noise.`;
  const [lead, trail] = m.winner === "typesafe" ? ["TypeSafe", "OpenAI"] : ["OpenAI", "TypeSafe"];
  const leadPass = (m.winner === "typesafe" ? m.typesafe : m.openai).success;
  const trailPass = (m.winner === "typesafe" ? m.openai : m.typesafe).success;
  const verdict = leadPass && !trailPass ? `and only ${lead} passed` : leadPass && trailPass ? "and both passed" : "and neither passed";
  return `${lead} scored ${Math.abs(m.delta)} points higher than ${trail} (${m.winner === "typesafe" ? t : o}% vs ${m.winner === "typesafe" ? o : t}%), ${verdict}.`;
}

/** The score band a 0..1 judge score falls in, with what that band means. */
export function bandFor(result: Pick<EvalResult, "score" | "bands">): { low: number; high: number; outcome: string; points: number } | null {
  const points = Math.round(result.score * 10);
  const band = result.bands.find((b) => points >= b.low && points <= b.high);
  return band ? { ...band, points } : null;
}
