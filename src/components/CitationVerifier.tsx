"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ActivityFinish, ActivityKind } from "@/lib/activity/log";
import { citationGroups, mostConsequential, summarizeCitations, VERDICT_LABEL } from "@/lib/compare/rows";
import { RELATION_LABELS } from "@/lib/citations/batch";
import { extractChecks } from "@/lib/citations/extract";
import { startRun, type RunDeps } from "@/lib/citations/run";
import { citationSig, citationStore, hash } from "@/lib/citations/store";
import { buildCitationPacket } from "@/lib/eval/packets";
import { noOpenAIAnswerReason } from "@/lib/openai/unavailable";
import type { KeyOverride } from "@/lib/typesafe/client";
import { useIsRendered } from "@/lib/useIsRendered";
import type { BackendContextMetrics } from "./ContextMeter";
import { ComparisonTable } from "./ComparisonTable";
import { EvalSummaryBar, type SummaryStat } from "./EvalSummaryBar";
import { EvaluationPanel } from "./EvaluationPanel";
import { OpenAINote } from "./OpenAINote";
import { RerunButton } from "./RerunButton";

/**
 * Citations, automatically. The document (or the passage highlighted in it) is read as soon as this tab is on screen:
 * every reference the text makes, and every key term with the clause that covers it, are pulled out by rule
 * (src/lib/citations/extract.ts), then judged in one batched request to each backend. Nothing is typed in. The one thing a
 * reader chooses is which check the independent judge scores, defaulting to the one that matters most.
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

  function start() {
    const deps: RunDeps = {
      typesafeOverride,
      openaiOverride,
      openaiConfigured,
      beginActivity: (actor, kind, label) => (actor === "typesafe" ? onBeginTypesafeActivity(kind, label) : onBeginOpenaiActivity(kind, label)),
      finishActivity: (actor, id, result) => (actor === "typesafe" ? onFinishTypesafeActivity(id, result) : onFinishOpenaiActivity(id, result)),
      onMetrics: (actor, metrics) => (actor === "typesafe" ? onTypesafeMetrics?.(metrics) : onOpenaiMetrics?.(metrics)),
    };
    void startRun(sig, extraction, deps);
  }

  // The first time this text is on screen, read and check it. `claim` makes that happen once even if the tab renders twice, and
  // a text already checked this session (a passage, then back to the whole document) shows its earlier results instead.
  useEffect(() => {
    if (!rendered || extraction.checks.length === 0 || !citationStore.claim(sig)) return;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, sig, extraction.checks.length]);

  const [chosen, setChosen] = useState<string | null>(null);
  const summary = summarizeCitations(extraction, run);
  const judgeable = extraction.checks.filter((c) => c.resolution === "model" && run?.typesafe.judged[c.id]);
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

  const groups = citationGroups(extraction, run, openaiConfigured);
  const refCount = extraction.checks.filter((c) => c.kind === "reference").length;
  const running = run?.typesafe.status === "pending" || run?.openai.status === "pending";
  const failed = run?.typesafe.status === "error" ? run.typesafe.message : undefined;

  const packet = (backend: "typesafe" | "openai") => {
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
        <EvalSummaryBar icon="search" headline={extraction.checks.length ? `${extraction.checks.length} checks` : "Nothing to check"} stats={stats} />
        {extraction.checks.length > 0 && (
          <RerunButton
            onClick={() => {
              citationStore.drop(sig);
              citationStore.claim(sig);
              start();
            }}
            pending={Boolean(running)}
            label="Re-check"
          />
        )}
      </div>

      <p className="text-xs text-muted">
        {passage ? "Read from your highlighted passage." : <>Read automatically from <span className="font-semibold text-secondary">{documentName ?? "the document"}</span>.</>} References are
        checked against the section they cite, and key terms against the internal Contract Playbook (fictional, for this demo).
      </p>
      {!openaiConfigured && (
        <p className="text-xs text-muted">
          Set <code className="text-accent-soft-ink">OPENAI_API_KEY</code> to see OpenAI&rsquo;s answer beside each check.
        </p>
      )}
      <OpenAINote outcome={run?.openai.status === "error" || run?.openai.reason === "error" ? { ok: false, reason: "error", message: run.openai.message } : null} />
      {failed && <p className="rounded-lg border border-rose-600/30 bg-rose-600/[0.06] px-3 py-2 text-xs font-semibold text-rose-900">The citation check failed: {failed}</p>}

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-3 py-3 text-sm text-muted">
          {passage ? "Nothing to check in this passage. Highlight a clause, or a sentence that cites another section." : "Nothing in this document could be read as a reference or a key term."}
        </p>
      ) : (
        <ComparisonTable groups={groups} label="Citation checks" firstColumn="Check" />
      )}
      {groups.length > 0 && refCount === 0 && <p className="text-xs text-muted">No references or citations are written in this text, so only its key terms were checked.</p>}

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
            scope={`citation:${judged.id}:${hash(sig)}`}
            typesafePacket={packet("typesafe")}
            typesafeSource={run?.typesafe.source ?? null}
            openaiPacket={packet("openai")}
            openaiConfigured={openaiConfigured}
            openaiEmptyReason={run?.openai.judged[judged.id] || run?.openai.status === "pending" ? undefined : noOpenAIAnswerReason(run?.openai.status === "error" ? { ok: false, reason: "error", message: run.openai.message } : null, "the relation answer")}
          />
        </>
      )}
    </div>
  );
}
