"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { formatElapsed, type ActivityFinish, type ActivityKind } from "@/lib/activity/log";
import { citationGroups, filterExtraction, judgedOf, mostConsequential, modelsDisagree, needsAttention, summarizeCitations, VERDICT_LABEL, type CitationFilter } from "@/lib/compare/rows";
import { openaiCostUsd } from "@/lib/compare/openaiEquivalent";
import { fmtUsd, typesafeCostUsd } from "@/lib/compare/pricing";
import { RELATION_LABELS } from "@/lib/citations/batch";
import { MAX_REFERENCES, extractChecks } from "@/lib/citations/extract";
import { startRun, type RunDeps } from "@/lib/citations/run";
import { citationSig, citationStore, hash, type SideRun } from "@/lib/citations/store";
import { buildCitationPacket } from "@/lib/eval/packets";
import { evalStore } from "@/lib/eval/store";
import { noOpenAIAnswerReason } from "@/lib/openai/unavailable";
import type { KeyOverride } from "@/lib/typesafe/client";
import { useIsRendered } from "@/lib/useIsRendered";
import type { BackendContextMetrics } from "./ContextMeter";
import { ComparisonTable } from "./ComparisonTable";
import { EvalSummaryBar, type SummaryStat } from "./EvalSummaryBar";
import { EvaluationPanel } from "./EvaluationPanel";
import { RerunButton } from "./RerunButton";

type Backend = "typesafe" | "openai";
const tokens = (n: number) => n.toLocaleString("en-US");

/** One model's part in this run: what it is doing or did, how long and how much it took, or why it did not, with a way to try again. */
function ModelRun({ name, side, onRetry, retryDisabled }: { name: string; side: SideRun | undefined; onRetry: () => void; retryDisabled: boolean }) {
  const status = side?.status ?? "pending";
  const pending = status === "pending" || status === "idle";
  const dot = pending ? "animate-pulse-dot bg-amber-500" : status === "done" ? "bg-emerald-600" : status === "error" ? "bg-rose-600" : "bg-muted";

  let state = "checking…";
  let detail: string | null = null;
  if (status === "done" && side) {
    const demo = side.source === "mock";
    const cost = side.usage ? (name === "OpenAI" ? openaiCostUsd(side.model ?? "", side.usage) : typesafeCostUsd(demo ? "mock" : "live", side.usage)) : null;
    state = `done in ${formatElapsed(side.elapsedMs ?? 0)}`;
    detail = [
      demo ? "local demo heuristic, not the live model" : side.model,
      side.usage ? `${tokens(side.usage.input_tokens)} in / ${tokens(side.usage.output_tokens)} out tokens` : null,
      cost != null && !demo ? fmtUsd(cost) : null,
    ].filter(Boolean).join(" · ");
  } else if (status === "error") {
    state = "failed";
    detail = side?.message ?? "The call failed.";
  } else if (status === "skipped") {
    state = "not run";
    detail = side?.reason === "not_configured" ? `Save an ${name} key in Settings (the gear icon) and it runs by itself.` : "There is nothing here for a model to judge.";
  }

  return (
    <div className="flex min-w-0 items-start gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-xs">
      <span aria-hidden className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1 leading-snug">
        <p className="font-bold text-foreground">
          {name} <span className={`font-medium ${status === "error" ? "text-rose-800" : "text-muted"}`}>{state}</span>
        </p>
        {detail && <p className={`break-words ${status === "error" ? "text-rose-900" : "text-muted"}`}>{detail}</p>}
        {status === "done" && side?.fallbackFrom && (
          <p className="mt-0.5 break-words font-semibold text-amber-800">
            Requested <code className="font-mono">{side.fallbackFrom}</code> wasn&rsquo;t available on this key, so <code className="font-mono">{side.model}</code> judged these.
          </p>
        )}
      </div>
      {status === "error" && (
        <button
          onClick={onRetry}
          disabled={retryDisabled}
          className="flex min-h-9 shrink-0 items-center rounded-full border border-border-strong bg-elevated px-3 text-xs font-bold text-secondary transition-colors hover:border-deep/30 hover:text-deep disabled:opacity-50"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * Citations, automatically. The document (or the passage highlighted in it) is read as soon as this tab is on screen:
 * every reference the text makes, and every key term with the clause that covers it, are pulled out by rule
 * (src/lib/citations/extract.ts), then judged in one batched request to each backend. Nothing is typed in. The one thing a
 * reader chooses is which check the independent judge scores, defaulting to the one that matters most.
 *
 * Re-check runs the whole process again: both models, and the judge on the checks it had scored. Each model's state is shown,
 * and one that failed can be retried on its own without disturbing the other's answers.
 */
export function CitationVerifier({
  documentKey,
  documentName,
  documentText,
  selectedExcerpt,
  openaiConfigured,
  typesafeOverride,
  openaiOverride,
  onBeginTypesafeActivity,
  onFinishTypesafeActivity,
  onBeginOpenaiActivity,
  onFinishOpenaiActivity,
  onTypesafeMetrics,
  onOpenaiMetrics,
}: {
  /** Identifies the loaded document, so each document's results are kept apart. */
  documentKey?: string | null;
  documentName?: string | null;
  documentText?: string | null;
  /** The passage highlighted in the Document panel: when there is one, it is what gets read. */
  selectedExcerpt?: string | null;
  openaiConfigured: boolean;
  typesafeOverride?: KeyOverride;
  openaiOverride?: KeyOverride;
  /** Every model call reports to the same activity log, so its timing and cost show in the header and the Trace tab. */
  onBeginTypesafeActivity: (kind: ActivityKind, label: string) => number;
  onFinishTypesafeActivity: (id: number, result: ActivityFinish) => void;
  onBeginOpenaiActivity: (kind: ActivityKind, label: string) => number;
  onFinishOpenaiActivity: (id: number, result: ActivityFinish) => void;
  onTypesafeMetrics?: (metrics: BackendContextMetrics) => void;
  onOpenaiMetrics?: (metrics: BackendContextMetrics) => void;
}) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const rendered = useIsRendered(sectionRef);
  useSyncExternalStore(citationStore.subscribe, citationStore.version, () => 0);

  const passage = selectedExcerpt?.trim() ? selectedExcerpt : null;
  const scope = passage ? "excerpt" : "document";
  const text = passage ?? documentText ?? "";
  const extraction = useMemo(() => extractChecks({ text, fullText: documentText ?? undefined, scope }), [text, documentText, scope]);
  const sig = citationSig(documentKey ?? "none", scope, text);
  const run = citationStore.get(sig);
  const judgeScope = (id: string) => `citation:${id}:${hash(sig)}`;

  function start(only?: Backend) {
    const deps: RunDeps = {
      typesafeOverride,
      openaiOverride,
      openaiConfigured,
      beginActivity: (actor, kind, label) => (actor === "typesafe" ? onBeginTypesafeActivity(kind, label) : onBeginOpenaiActivity(kind, label)),
      finishActivity: (actor, id, result) => (actor === "typesafe" ? onFinishTypesafeActivity(id, result) : onFinishOpenaiActivity(id, result)),
      onMetrics: (actor, metrics) => (actor === "typesafe" ? onTypesafeMetrics?.(metrics) : onOpenaiMetrics?.(metrics)),
    };
    void startRun(sig, extraction, deps, only);
  }

  // The first time this text is on screen, read and check it. `claim` makes that happen once even if the tab renders twice, and
  // a text already checked this session (a passage, then back to the whole document) shows its earlier results instead.
  useEffect(() => {
    if (!rendered || extraction.checks.length === 0 || !citationStore.claim(sig)) return;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, sig, extraction.checks.length]);

  // OpenAI can be recognised after a text was first checked (its key is validated a moment after the page loads, or saved in
  // Settings meanwhile). The run then skipped it, so it is started now against that same run, once, without touching TypeSafe's.
  const openaiSkipped = run?.openai.status === "skipped" && run.openai.reason === "not_configured";
  useEffect(() => {
    if (!rendered || !run || !openaiConfigured || !openaiSkipped) return;
    if (citationStore.claim(`${sig}|openai|${run.tokens.openai}`)) start("openai");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, openaiConfigured, openaiSkipped, sig]);

  /** The full process again: read the text, ask both models, and have the judge score afresh what it had scored. */
  function recheck() {
    for (const c of extraction.checks) if (c.resolution === "model") evalStore.forget(judgeScope(c.id));
    citationStore.drop(sig);
    citationStore.claim(sig);
    start();
  }

  const [chosen, setChosen] = useState<string | null>(null);
  const [filter, setFilter] = useState<CitationFilter>("all");
  const summary = summarizeCitations(extraction, run);
  const judgeable = extraction.checks.filter((c) => c.resolution === "model" && judgedOf(run, "typesafe", c.id));
  const judgedId = judgeable.some((c) => c.id === chosen) ? chosen : mostConsequential(extraction, run);
  const judged = judgeable.find((c) => c.id === judgedId);

  if (!documentText?.trim()) {
    // The same wrapper carries the visibility ref in every state, so the check starts the moment a document loads and this tab is open.
    return (
      <div ref={sectionRef}>
        <p className="text-base text-secondary">Load or upload a document, and its citations and key terms are found and checked here automatically.</p>
      </div>
    );
  }

  const stats: SummaryStat[] = [];
  if (summary.supported) stats.push({ label: "supported:", value: String(summary.supported), tone: "emerald" });
  if (summary.contradicted) stats.push({ label: "contradicted:", value: String(summary.contradicted), tone: "rose" });
  if (summary.notAddressed) stats.push({ label: "not addressed:", value: String(summary.notAddressed), tone: "amber" });
  if (summary.broken) stats.push({ label: "broken:", value: String(summary.broken), tone: "rose" });
  if (summary.missing) stats.push({ label: "missing:", value: String(summary.missing), tone: "amber" });
  if (summary.pending) stats.push({ label: "checking:", value: String(summary.pending) });
  if (summary.compared) stats.push({ label: "agree:", value: `${summary.agreed}/${summary.compared}`, tone: summary.agreed === summary.compared ? "emerald" : summary.agreed === 0 ? "rose" : "amber" });

  const attention = extraction.checks.filter((c) => needsAttention(c, run)).length;
  const disagree = extraction.checks.filter((c) => modelsDisagree(c, run)).length;
  const filters: { id: CitationFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: extraction.checks.length },
    { id: "attention", label: "Needs attention", count: attention },
    ...(summary.compared > 0 ? [{ id: "disagree" as const, label: "Models disagree", count: disagree }] : []),
  ];
  // A filter that has stopped applying (the models are no longer both answered) falls back to showing everything.
  const active = filters.some((f) => f.id === filter) ? filter : "all";

  const shown = filterExtraction(extraction, run, active);
  const groups = citationGroups(shown, run, openaiConfigured);
  const refCount = extraction.checks.filter((c) => c.kind === "reference").length;
  const running = run?.typesafe.status === "pending" || run?.openai.status === "pending";

  const packet = (backend: Backend) => {
    const j = judged ? (backend === "typesafe" ? run?.typesafe : run?.openai)?.judged[judged.id] : undefined;
    if (!judged || !j) return null;
    return buildCitationPacket({
      claim: judged.claim,
      quote: judged.kind === "term" ? judged.quote : null,
      verdict: j.verdict,
      relation: RELATION_LABELS[j.relation],
      sectionId: judged.sourceId,
      sectionText: judged.source,
    });
  };

  return (
    <div ref={sectionRef} className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <EvalSummaryBar icon="search" headline={extraction.checks.length ? `${extraction.checks.length} check${extraction.checks.length === 1 ? "" : "s"}` : "Nothing to check"} stats={stats} />
        </div>
        {extraction.checks.length > 0 && <RerunButton onClick={recheck} pending={Boolean(running)} label="Re-check" title="Read the text again, ask both models, and have the judge score afresh" />}
      </div>

      {extraction.checks.some((c) => c.resolution === "model") && (
        <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2">
          <ModelRun name="TypeSafe" side={run?.typesafe} onRetry={() => start("typesafe")} retryDisabled={Boolean(running)} />
          <ModelRun name="OpenAI" side={run ? run.openai : openaiConfigured ? undefined : { status: "skipped", judged: {}, reason: "not_configured" }} onRetry={() => start("openai")} retryDisabled={Boolean(running)} />
        </div>
      )}

      <p className="text-xs text-muted">
        {passage ? "Read from your highlighted passage." : <>Read automatically from <span className="font-semibold text-secondary">{documentName ?? "the document"}</span>.</>} References are
        checked against the section they cite, and key terms against the internal Contract Playbook (fictional, for this demo).
      </p>

      {extraction.checks.length > 0 && (
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={active === f.id}
              className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors ${
                active === f.id ? "border-deep bg-fill text-on-fill" : "border-border-strong bg-elevated text-secondary hover:border-deep/40 hover:text-deep"
              }`}
            >
              {f.label}
              <span className={`tabular-nums ${active === f.id ? "opacity-80" : "text-muted"}`}>{f.count}</span>
            </button>
          ))}
        </div>
      )}

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-3 py-3 text-sm text-muted">
          {extraction.checks.length === 0
            ? passage
              ? "Nothing to check in this passage. Highlight a clause, or a sentence that cites another section."
              : "Nothing in this document could be read as a reference or a key term."
            : active === "attention"
              ? "Nothing needs attention: every check that has an answer is supported."
              : "The two models agree on every check they both answered."}
        </p>
      ) : (
        <ComparisonTable groups={groups} label="Citation checks" firstColumn="Check" />
      )}
      {active === "all" && (extraction.omittedReferences ?? 0) > 0 && (
        <p className="text-xs text-muted" role="note">
          This text cites more than the {MAX_REFERENCES} references checked here: {extraction.omittedReferences} more {extraction.omittedReferences === 1 ? "was" : "were"} left out. Highlight a section to check the rest.
        </p>
      )}
      {active === "all" && groups.length > 0 && refCount === 0 && <p className="text-xs text-muted">No references or citations are written in this text, so only its key terms were checked.</p>}

      {judgeable.length > 0 && judged && (
        <>
          <label className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-secondary">
            <span className="text-muted">The judge is scoring:</span>
            <select
              value={judged.id}
              onChange={(e) => setChosen(e.target.value)}
              aria-label="Check the judge scores"
              className="min-h-9 min-w-0 max-w-full rounded-lg border border-border-strong bg-elevated px-2 py-1.5 text-xs font-semibold text-foreground outline-none focus:border-deep focus-visible:ring-2 focus-visible:ring-deep/50"
            >
              {judgeable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} &middot; {VERDICT_LABEL[run!.typesafe.judged[c.id].verdict]}
                </option>
              ))}
            </select>
          </label>
          <EvaluationPanel
            key={judged.id}
            kind="citation"
            scope={judgeScope(judged.id)}
            typesafePacket={packet("typesafe")}
            typesafeSource={run?.typesafe.source ?? null}
            openaiPacket={packet("openai")}
            openaiConfigured={openaiConfigured}
            openaiEmptyReason={
              judgedOf(run, "openai", judged.id) || run?.openai?.status === "pending"
                ? undefined
                : noOpenAIAnswerReason(run?.openai.status === "error" ? { ok: false, reason: "error", message: run.openai.message } : null, "the relation answer")
            }
          />
        </>
      )}
    </div>
  );
}
