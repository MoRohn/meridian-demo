"use client";

import { useState, useSyncExternalStore } from "react";
import { elapsedOf, formatElapsed, type ActivityRecord } from "@/lib/activity/log";
import { useActivities, useNow } from "@/lib/activity/hooks";
import {
  BACKENDS,
  BACKEND_NAMES,
  compareBackends,
  describeMatchup,
  matchups,
  performanceVerdict,
  summarizeBackend,
  type BackendPerformance,
  type Edge,
} from "@/lib/compare/performance";
import { fmtUsd } from "@/lib/compare/pricing";
import { evalStore } from "@/lib/eval/store";
import { EVAL_KINDS } from "@/lib/eval/kinds";
import type { EvalKind } from "@/lib/eval/types";
import { Icon } from "./Icon";

const EDGE_STYLE: Record<Edge, string> = {
  typesafe: "border-deep/25 bg-deep/10 text-deep",
  openai: "border-violet-600/25 bg-violet-500/10 text-violet-800",
  tie: "border-border-strong bg-elevated text-secondary",
  "n/a": "border-border bg-elevated text-muted",
};
const edgeText = (e: Edge) => (e === "tie" ? "Level" : e === "n/a" ? "n/a" : `${BACKEND_NAMES[e]} ahead`);

const pct = (x: number | null) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);
const time = (ms: number | undefined) => (ms == null ? "n/a" : formatElapsed(ms));
const count = (n: number) => n.toLocaleString("en-US");

function Row({ label, values }: { label: string; values: [string, string] }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-baseline gap-x-2 border-t border-border/60 py-1.5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_7rem_7rem]">
      <dt className="text-secondary">{label}</dt>
      {values.map((v, i) => (
        <dd key={i} className="text-right font-bold tabular-nums text-foreground">
          {v}
        </dd>
      ))}
    </div>
  );
}

function metricRows(ts: BackendPerformance, oa: BackendPerformance) {
  const both = (f: (p: BackendPerformance) => string): [string, string] => [f(ts), f(oa)];
  return [
    { label: "Calls (failed)", values: both((p) => `${p.calls} (${p.failures})`) },
    { label: "Median time", values: both((p) => time(p.latency?.median)) },
    { label: "Fastest / slowest", values: both((p) => (p.latency ? `${formatElapsed(p.latency.min)} / ${formatElapsed(p.latency.max)}` : "n/a")) },
    { label: "Slowest 5% (p95)", values: both((p) => time(p.latency?.p95)) },
    { label: "Input tokens", values: both((p) => count(p.inputTokens)) },
    { label: "Output tokens", values: both((p) => count(p.outputTokens)) },
    { label: "Total cost", values: both((p) => (p.calls > 0 ? fmtUsd(p.costUsd) : "n/a")) },
    { label: "Cost per passing answer", values: both((p) => (p.costPerPass != null ? fmtUsd(p.costPerPass) : "n/a")) },
    { label: "Answers judged", values: both((p) => String(p.quality.evaluated)) },
    { label: "Average judge score", values: both((p) => pct(p.quality.meanScore)) },
    { label: "Pass rate", values: both((p) => (p.quality.passRate == null ? "n/a" : `${pct(p.quality.passRate)} (${p.quality.passed}/${p.quality.evaluated})`)) },
  ];
}

/**
 * How the two models compare on what was actually measured this session: speed, tokens, cost and failures from the
 * activity log, quality from the independent judge. Every figure comes from a real call; where there is no data the
 * panel says "n/a" instead of guessing.
 */
export function PerformancePanel() {
  const records = useActivities();
  useSyncExternalStore(evalStore.subscribe, evalStore.version, () => 0);
  const evals = evalStore.rows();
  const [ts, oa] = BACKENDS.map((b) => summarizeBackend(b, records, evals)) as [BackendPerformance, BackendPerformance];
  if (ts.calls + oa.calls + ts.quality.evaluated + oa.quality.evaluated === 0) return null;

  const dims = compareBackends(ts, oa);
  const kinds = (Object.keys(EVAL_KINDS) as EvalKind[]).filter((k) => ts.quality.byKind[k] || oa.quality.byKind[k]);
  const pairs = matchups(evals);

  return (
    <section aria-label="Model performance" className="space-y-3 rounded-xl border border-border bg-elevated/50 p-3.5">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-extrabold text-deep">
          <Icon name="scale" size={16} />
          Model performance
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          TypeSafe and OpenAI compared on the calls made this session: speed, tokens and cost as measured, quality as scored by the independent judge.
        </p>
      </div>

      <p className="text-sm font-semibold leading-relaxed text-foreground">{performanceVerdict(dims, ts, oa)}</p>

      <ul className="grid grid-cols-1 gap-2 @lg:grid-cols-2">
        {dims.map((d) => (
          <li key={d.id} className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-muted">{d.label}</span>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold ${EDGE_STYLE[d.edge]}`}>{edgeText(d.edge)}</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-secondary">{d.detail}</p>
          </li>
        ))}
      </ul>

      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-x-2 pb-1 text-xs font-bold uppercase tracking-wide text-muted sm:grid-cols-[minmax(0,1fr)_7rem_7rem]">
          <span>Metric</span>
          <span className="text-right">TypeSafe</span>
          <span className="text-right">OpenAI</span>
        </div>
        <dl>
          {metricRows(ts, oa).map((r) => (
            <Row key={r.label} {...r} />
          ))}
          {kinds.map((k) => (
            <Row
              key={k}
              label={`Score: ${EVAL_KINDS[k].title.replace(/ evaluation$/, "").toLowerCase()}`}
              values={BACKENDS.map((b) => {
                const slot = (b === "typesafe" ? ts : oa).quality.byKind[k];
                return slot ? `${pct(slot.meanScore)} (${slot.n})` : "n/a";
              }) as [string, string]}
            />
          ))}
        </dl>
      </div>

      {pairs.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Same action, both models</h3>
          <ul className="space-y-1.5">
            {pairs.map((m) => (
              <li key={m.scope} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-secondary">
                <span className="font-bold text-foreground">{m.kind ? EVAL_KINDS[m.kind].title : m.scope}</span>
                {m.scope.endsWith(":excerpt") && <span className="text-muted"> (highlighted excerpt)</span>}
                <br />
                {describeMatchup(m)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const ACTOR: Record<ActivityRecord["actor"], { name: string; dot: string }> = {
  typesafe: { name: "TypeSafe", dot: "bg-deep" },
  openai: { name: "OpenAI", dot: "bg-violet-500" },
  judge: { name: "Judge", dot: "bg-amber-600" },
  writer: { name: "Answer writer", dot: "bg-sky-600" },
};
const KIND_LABEL: Record<ActivityRecord["kind"], string> = { chat: "Chat", excerpt: "Excerpt", citation: "Citation", evaluation: "Evaluation", answer: "Answer" };
const VISIBLE = 8;

function ActivityRow({ record, now }: { record: ActivityRecord; now: number }) {
  const a = ACTOR[record.actor];
  const pending = record.status === "pending";
  const facts: string[] = [];
  if (record.model) facts.push(record.model);
  if (record.inputTokens != null && record.inputTokens + (record.outputTokens ?? 0) > 0) facts.push(`${count(record.inputTokens)} in / ${count(record.outputTokens ?? 0)} out`);
  if (record.costUsd != null && !record.simulated) facts.push(fmtUsd(record.costUsd));
  if (record.score != null) facts.push(`scored ${Math.round(record.score * 100)}%`);
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-lg border border-border bg-surface px-3 py-2">
      <span
        aria-hidden
        className={`mt-1.5 h-2 w-2 rounded-full ${pending ? "animate-pulse-dot bg-amber-500" : record.status === "error" ? "bg-rose-600" : a.dot}`}
      />
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-bold text-foreground">{a.name}</span>
          <span className="rounded bg-elevated px-1.5 py-px text-[11px] font-bold uppercase tracking-wide text-muted">{KIND_LABEL[record.kind]}</span>
          {record.simulated && <span className="text-xs text-muted">no model call</span>}
        </p>
        <p className="truncate text-xs text-secondary" title={record.label}>
          {record.label}
        </p>
        {record.status === "error" && <p className="mt-0.5 text-xs font-semibold text-rose-800">Failed{record.note ? `: ${record.note}` : ""}</p>}
        {!pending && facts.length > 0 && <p className="mt-0.5 text-xs text-muted">{facts.join(" · ")}</p>}
      </div>
      <span
        className={`whitespace-nowrap text-sm font-bold tabular-nums ${pending ? "text-amber-800" : record.status === "error" ? "text-rose-800" : "text-foreground"}`}
        aria-label={pending ? "running" : "elapsed"}
      >
        {formatElapsed(elapsedOf(record, now))}
        {pending && "…"}
      </span>
    </li>
  );
}

/**
 * Every model call this session, newest first. Each row has its own timer that starts from zero when that call starts:
 * it counts up while the call runs and freezes on the measured time when it ends.
 */
export function ActivityTrace() {
  const records = useActivities();
  const [showAll, setShowAll] = useState(false);
  const running = records.filter((r) => r.status === "pending").length;
  const now = useNow(running > 0);
  if (records.length === 0) return null;

  const newestFirst = [...records].reverse();
  const shown = showAll ? newestFirst : newestFirst.slice(0, VISIBLE);
  return (
    <section aria-label="Activity trace" className="space-y-2 rounded-xl border border-border bg-elevated/50 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-extrabold text-deep">
          <Icon name="trace" size={16} />
          Activity trace
        </h2>
        <span className="text-xs font-semibold text-muted" role="status">
          {running > 0 ? `${running} running` : `${records.length} call${records.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <ul className="space-y-1.5">
        {shown.map((r) => (
          <ActivityRow key={r.id} record={r} now={now} />
        ))}
      </ul>
      {newestFirst.length > VISIBLE && (
        <button onClick={() => setShowAll((v) => !v)} className="text-xs font-bold text-secondary hover:text-deep">
          {showAll ? "Show fewer" : `Show all ${newestFirst.length}`}
        </button>
      )}
    </section>
  );
}
