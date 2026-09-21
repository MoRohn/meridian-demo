"use client";

import { useState, useSyncExternalStore } from "react";
import { formatElapsed, shownElapsed, type ActivityRecord } from "@/lib/activity/log";
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
    { label: "Model total time", values: both((p) => time(p.answerLatency?.median)) },
    { label: "Model reasoning", values: both((p) => time(p.reasoningLatency?.median)) },
    { label: "LLM response", values: both((p) => time(p.writingLatency?.median)) },
    { label: "Input tokens (reasoning)", values: both((p) => count(p.inputTokens)) },
    { label: "Output tokens (reasoning)", values: both((p) => count(p.outputTokens)) },
    { label: "Total cost (reasoning + LLM response)", values: both((p) => (p.calls > 0 ? fmtUsd(p.costUsd) : "n/a")) },
    { label: "Cost for reasoning", values: both((p) => (p.calls > 0 ? fmtUsd(p.reasoningCostUsd) : "n/a")) },
    { label: "Cost for LLM response", values: both((p) => (p.writingCostUsd != null ? fmtUsd(p.writingCostUsd) : "n/a")) },
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
        <p className="mt-2 border-t border-border/60 pt-2 text-xs leading-relaxed text-muted">
          Median per chat turn. <strong className="text-secondary">Model total time</strong> is the whole time to answer, the figure the chat card and
          header timer show. <strong className="text-secondary">Model reasoning</strong> is the backend&rsquo;s own judgment call.{" "}
          <strong className="text-secondary">LLM response</strong> is the model that writes the reply, the same one for both backends (n/a when no
          model wrote it, as with a refusal). Total is reasoning plus response plus the network. Total cost is the reasoning calls plus the LLM
          response calls, each priced from its measured tokens.
        </p>
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
  judge: { name: "Judge", dot: "bg-teal-600" },
  writer: { name: "Answer writer", dot: "bg-sky-600" },
};
const KIND_LABEL: Record<ActivityRecord["kind"], string> = { chat: "chat", excerpt: "excerpt", citation: "citations", evaluation: "evaluation", answer: "answer" };
const VISIBLE = 10;

/** A chat turn by a backend: its own reasoning call plus the LLM response that wrote its reply, shown as one row. */
const isTurn = (r: ActivityRecord) => r.kind === "chat" && (r.actor === "typesafe" || r.actor === "openai");

/** What a row cost: for a chat turn, reasoning plus LLM response. Null when nothing measured a cost. */
function costOf(r: ActivityRecord): number | null {
  const reasoning = r.simulated ? null : (r.costUsd ?? null);
  const writing = r.answerCostUsd ?? null;
  return reasoning == null && writing == null ? null : (reasoning ?? 0) + (writing ?? 0);
}

function ActivityRow({ record, now }: { record: ActivityRecord; now: number }) {
  const a = ACTOR[record.actor];
  const pending = record.status === "pending";
  const failed = record.status === "error";
  const cost = pending || failed ? null : costOf(record);
  const tokens = record.inputTokens != null && record.inputTokens + (record.outputTokens ?? 0) > 0 ? `${count(record.inputTokens)} in / ${count(record.outputTokens ?? 0)} out` : null;

  // One muted line under the headline. A chat turn spells out its parts, so the total reconciles with the metrics table.
  const parts: string[] = [];
  if (isTurn(record)) {
    parts.push(record.simulated ? "reasoning: local demo heuristic, no model call" : `reasoning ${record.modelMs != null ? formatElapsed(record.modelMs) : "n/a"}${record.model ? ` · ${record.model}` : ""}${tokens ? ` · ${tokens}` : ""}`);
    if (record.answerMs != null) parts.push(`LLM response ${formatElapsed(record.answerMs)}${record.answerModel ? ` · ${record.answerModel}` : ""}`);
  } else {
    if (record.model) parts.push(record.model);
    if (tokens) parts.push(tokens);
    if (record.score != null) parts.push(`scored ${Math.round(record.score * 100)}%`);
    if (record.simulated) parts.push("no model call");
  }
  const detail = failed ? `Failed${record.note ? `: ${record.note}` : ""}` : pending ? "" : parts.join("  |  ");

  return (
    <li className="rounded-md border border-border bg-surface px-2.5 py-1.5" title={`${a.name} · ${KIND_LABEL[record.kind]} · ${record.label}`}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-baseline gap-x-2 text-xs">
        <span aria-hidden className={`h-2 w-2 self-center rounded-full ${pending ? "animate-pulse-dot bg-amber-500" : failed ? "bg-rose-600" : a.dot}`} />
        <p className="truncate">
          <span className="font-bold text-foreground">{a.name}</span>
          <span className="text-muted"> {KIND_LABEL[record.kind]} · </span>
          <span className="text-secondary">{record.label}</span>
        </p>
        <span className={`whitespace-nowrap text-sm font-bold tabular-nums ${pending ? "text-amber-800" : failed ? "text-rose-800" : "text-foreground"}`}>
          <span className="sr-only">{pending ? "running for " : "took "}</span>
          {formatElapsed(shownElapsed(record, now))}
          {pending && "…"}
        </span>
        <span className="w-[4.75rem] whitespace-nowrap text-right tabular-nums text-secondary">
          {cost != null && (
            <>
              <span className="sr-only">cost </span>
              {fmtUsd(cost)}
            </>
          )}
        </span>
      </div>
      {detail && <p className={`mt-0.5 truncate pl-4 text-[11px] leading-snug ${failed ? "font-semibold text-rose-800" : "text-muted"}`}>{detail}</p>}
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
  // The answer-writing calls are folded into their backend's chat row (as its LLM response), so they are not listed twice.
  const rows = records.filter((r) => r.actor !== "writer");
  const running = rows.filter((r) => r.status === "pending").length;
  const now = useNow(running > 0);
  if (rows.length === 0) return null;

  const newestFirst = [...rows].reverse();
  const shown = showAll ? newestFirst : newestFirst.slice(0, VISIBLE);
  return (
    <section aria-label="Activity trace" className="space-y-2 rounded-xl border border-border bg-elevated/50 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-extrabold text-deep">
          <Icon name="trace" size={16} />
          Activity trace
        </h2>
        <span className="text-xs font-semibold text-muted" role="status">
          {running > 0 ? `${running} running` : `${rows.length} call${rows.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <ul className="space-y-1">
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
