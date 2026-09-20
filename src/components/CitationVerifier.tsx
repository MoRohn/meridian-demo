"use client";

import { useMemo, useState } from "react";
import type { CitationCheckResult } from "@/lib/skills/citationVerifier";
import { CITATION_EXAMPLES } from "@/lib/data/citationExamples";
import { AUTHORITY_TITLE } from "@/lib/data/authorities";
import { suggestCitations } from "@/lib/citations/suggest";
import type { OpenAIRunOutcome } from "@/lib/openai/types";
import type { KeyOverride } from "@/lib/typesafe/client";
import { ProbabilityBar } from "./ProbabilityBar";
import { ActivityWindow, type ActivityStatus } from "./ActivityWindow";
import type { ActivityFinish, ActivityKind } from "@/lib/activity/log";
import { openaiActivityResult, typesafeActivityResult } from "@/lib/activity/outcomes";
import { OpenAINote } from "./OpenAINote";
import { RerunButton } from "./RerunButton";
import { EvalSummaryBar, type SummaryStat } from "./EvalSummaryBar";
import { EvaluationPanel } from "./EvaluationPanel";
import { noOpenAIAnswerReason } from "@/lib/openai/unavailable";
import { buildCitationPacket } from "@/lib/eval/packets";

import type { BackendContextMetrics } from "./ContextMeter";

const VERDICT_STYLES: Record<CitationCheckResult["verdict"], string> = {
  verified: "border-emerald-600/30 bg-emerald-600/[0.06] text-emerald-800",
  contradicted: "border-rose-600/30 bg-rose-600/[0.06] text-rose-800",
  unsupported: "border-amber-600/30 bg-amber-600/[0.06] text-amber-800",
  fabricated: "border-rose-700/40 bg-rose-700/[0.06] text-rose-900",
};

const VERDICT_TONE: Record<CitationCheckResult["verdict"], "emerald" | "rose" | "amber"> = {
  verified: "emerald",
  contradicted: "rose",
  unsupported: "amber",
  fabricated: "rose",
};

/** The raw `relation` choice OpenAI returns, mapped the same way the TypeSafe side maps it to a verdict — so both columns can share one visual language instead of TypeSafe showing a styled verdict card next to OpenAI's plain, uncolored list. */
/** The relation names as the judge's rubric spells them. */
const RELATION_LABELS: Record<string, string> = { supports: "supports", contradicts: "contradicts", says_nothing: "says nothing (silent)" };

const OPENAI_RELATION_STYLE: Record<string, { verdict: CitationCheckResult["verdict"]; label: string }> = {
  supports: { verdict: "verified", label: "Supports" },
  contradicts: { verdict: "contradicted", label: "Contradicts" },
  says_nothing: { verdict: "unsupported", label: "Says nothing" },
};

async function compareOpenAICitation(
  sessionId: string,
  claim: string,
  quote: string | null,
  sectionId: string | undefined,
  override: KeyOverride | undefined
): Promise<OpenAIRunOutcome> {
  const res = await fetch("/api/compare-openai-citation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, claim, quote, sectionId, override }),
  });
  const data = await res.json();
  return data.outcome as OpenAIRunOutcome;
}

export function CitationVerifier({
  sessionId,
  documentName,
  documentText,
  onVerify,
  openaiConfigured,
  onBeginTypesafeActivity,
  onFinishTypesafeActivity,
  onBeginOpenaiActivity,
  onFinishOpenaiActivity,
  openaiOverride,
  selectedExcerpt,
  onOpenaiMetrics,
}: {
  sessionId: string;
  /** The active document, if one is loaded: its clauses become both the suggestions below and a source a quote can be found in. */
  documentName?: string | null;
  documentText?: string | null;
  onVerify: (claim: string, quote: string | null, sectionId?: string) => Promise<CitationCheckResult>;
  openaiConfigured: boolean;
  /**
   * Mirrors this check's status/timing up to the header pills — see
   * page.tsx. Epoch-guarded: a chat turn or excerpt scan started after this
   * check began, and finishing later, must not be able to stomp this
   * check's own "done"/"error" (or vice versa) — `begin` stakes a claim,
   * `finish` only applies if nothing newer has started since.
   */
  onBeginTypesafeActivity: (kind: ActivityKind, label: string) => number;
  onFinishTypesafeActivity: (id: number, result: ActivityFinish) => void;
  onBeginOpenaiActivity: (kind: ActivityKind, label: string) => number;
  onFinishOpenaiActivity: (id: number, result: ActivityFinish) => void;
  openaiOverride?: KeyOverride;
  /** The passage currently highlighted in the Document panel, if any — dropped straight into the quote field so Citations reacts to a highlight exactly like Risk and Compliance do. */
  selectedExcerpt?: string | null;
  /** Reports this check's real OpenAI input/output size up to the Context Window meter — see page.tsx. */
  onOpenaiMetrics?: (metrics: BackendContextMetrics) => void;
}) {
  // Pulled straight from the document, deterministically and for free: nothing is sent to a model until one is clicked.
  const suggestions = useMemo(() => suggestCitations(documentText), [documentText]);
  const [claim, setClaim] = useState("");
  const [quote, setQuote] = useState("");
  const [typesafeStatus, setTypesafeStatus] = useState<ActivityStatus>("idle");
  const [result, setResult] = useState<CitationCheckResult | null>(null);
  const [openaiStatus, setOpenaiStatus] = useState<ActivityStatus>("idle");
  /** The activity-log record behind each window's timer, replaced on every check so the timer starts again from zero. */
  const [typesafeActivityId, setTypesafeActivityId] = useState<number | null>(null);
  const [openaiActivityId, setOpenaiActivityId] = useState<number | null>(null);
  const [openaiOutcome, setOpenaiOutcome] = useState<OpenAIRunOutcome | null>(null);
  /** The exact params behind the result currently on screen, so the retry icon re-runs precisely that check, even after the text fields have since been edited. */
  const [lastRun, setLastRun] = useState<{ claim: string; quote: string; sectionId?: string } | null>(null);

  // A fresh highlight drops straight into the quote field — done during
  // render (React's documented pattern for adjusting state when a prop
  // changes) rather than in an effect, so it happens in the same paint as
  // the selection itself instead of one tick later.
  const [prevExcerpt, setPrevExcerpt] = useState(selectedExcerpt ?? null);
  if ((selectedExcerpt ?? null) !== prevExcerpt) {
    setPrevExcerpt(selectedExcerpt ?? null);
    if (selectedExcerpt) setQuote(selectedExcerpt);
  }

  /**
   * Same pattern as the chat turn's dual fetch (see page.tsx): both backends
   * are asked the identical locate-then-relate question, fired as two
   * independent requests at the same moment, each updating its own window
   * the instant it resolves — the Model Comparison capability covers this
   * task category exactly the same way it covers conversation turns.
   */
  async function runCheck(c: string, q: string, sectionId?: string) {
    setClaim(c);
    setQuote(q);
    setLastRun({ claim: c, quote: q, sectionId });
    setTypesafeStatus("pending");
    const label = `Citation check: ${c.length > 40 ? `${c.slice(0, 40)}…` : c}`;
    const tsEpoch = onBeginTypesafeActivity("citation", label);
    const oaEpoch = openaiConfigured ? onBeginOpenaiActivity("citation", label) : null;
    setTypesafeActivityId(tsEpoch);
    setOpenaiActivityId(oaEpoch);
    if (openaiConfigured) setOpenaiStatus("pending");

    const typesafePromise = onVerify(c, q.trim() ? q : null, sectionId)
      .then((r) => {
        setResult(r);
        setTypesafeStatus("done");
        // A fabricated quote is rejected by the local exact-text search: no model call, so nothing to time or count.
        onFinishTypesafeActivity(tsEpoch, r.elapsedMs > 0 ? typesafeActivityResult(r.source === "live" ? "live" : "mock", r.elapsedMs, r.usage) : { status: "done", simulated: true });
      })
      .catch((err) => {
        setTypesafeStatus("error");
        onFinishTypesafeActivity(tsEpoch, { status: "error", note: (err as Error).message });
      });

    const openaiPromise = openaiConfigured && oaEpoch != null
      ? compareOpenAICitation(sessionId, c, q.trim() ? q : null, sectionId, openaiOverride)
          .then((outcome) => {
            setOpenaiOutcome(outcome);
            setOpenaiStatus(outcome?.ok || outcome?.reason === "not_configured" ? "done" : "error");
            if (outcome?.ok) {
              onOpenaiMetrics?.({
                task: "Citation check",
                inputBytes: outcome.result.requestBytes,
                inputTokens: outcome.result.usage.input_tokens,
                outputTokens: outcome.result.usage.output_tokens,
              });
            }
            onFinishOpenaiActivity(oaEpoch, openaiActivityResult(outcome));
          })
          .catch((err) => {
            setOpenaiStatus("error");
            onFinishOpenaiActivity(oaEpoch, { status: "error", note: (err as Error).message });
          })
      : Promise.resolve();

    await Promise.all([typesafePromise, openaiPromise]);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Checks a claim against {documentText ? "your document and " : ""}
        <span className="text-secondary">{AUTHORITY_TITLE}</span> in two steps. First, an
        exact-text search locates the quoted section (no model call needed). Then both backends independently judge
        whether that section actually supports the claim.
      </p>

      <section aria-labelledby="cite-suggested" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p id="cite-suggested" className="text-xs font-bold uppercase tracking-wide text-muted">
            Suggested from your document
          </p>
          {documentText && documentName && <span className="truncate text-xs text-muted">{documentName}</span>}
        </div>
        {!documentText ? (
          <p className="rounded-xl border border-dashed border-border-strong px-3 py-3 text-sm text-muted">
            Load or upload a document and its clauses appear here as ready-to-check citations.
          </p>
        ) : suggestions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-strong px-3 py-3 text-sm text-muted">
            No clauses on a recognisable topic were found in this document. Highlight a passage in the document to use it as the quote.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 @xl:grid-cols-2">
            {suggestions.map((sg) => (
              <li key={sg.id} className="min-w-0">
                <button
                  onClick={() => runCheck(sg.claim, sg.quote, sg.id)}
                  disabled={typesafeStatus === "pending"}
                  aria-label={`Check ${sg.topicLabel} citation from ${sg.sectionLabel}`}
                  className="flex h-full w-full flex-col gap-1 rounded-xl border border-border-strong bg-surface p-3 text-left transition-colors hover:border-deep/40 hover:bg-surface-hover disabled:opacity-50"
                >
                  <span className="flex items-center justify-between gap-2 text-xs font-bold text-secondary">
                    <span className="truncate">{sg.sectionLabel}</span>
                    <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-accent-soft-ink">{sg.topicLabel}</span>
                  </span>
                  <span className="text-sm font-semibold text-foreground">{sg.claim}</span>
                  <span className="line-clamp-2 font-[family-name:var(--font-document)] text-xs italic text-muted">&ldquo;{sg.quote}&rdquo;</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">
          Each card pairs a typical claim about that kind of clause with the document&rsquo;s own words. Checking it shows whether the
          clause supports, contradicts or ignores the claim.
        </p>
      </section>

      <div className="space-y-1.5">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Playbook examples</p>
        <div className="flex flex-wrap gap-1.5">
          {CITATION_EXAMPLES.map((ex) => (
            <button
              key={ex.id}
              onClick={() => runCheck(ex.claim, ex.quote ?? "", ex.sectionId)}
              className="rounded-full border border-border-strong bg-surface px-2.5 py-1 text-sm text-secondary transition-colors hover:border-deep/30 hover:text-deep"
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      {selectedExcerpt && quote === selectedExcerpt && (
        <p className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-xs font-semibold text-accent-soft-ink">
          Quote filled in from your highlighted passage — add the claim it&rsquo;s supposedly backing up, then verify.
        </p>
      )}
      <div className="space-y-2">
        <textarea
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          placeholder="Claim being made…"
          rows={2}
          className="w-full resize-none rounded-xl border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <textarea
          value={quote}
          onChange={(e) => setQuote(e.target.value)}
          placeholder="Quoted text supposedly backing it up (leave blank to test a claim with no quote)…"
          rows={2}
          className="w-full resize-none rounded-xl border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button
          disabled={typesafeStatus === "pending" || !claim.trim()}
          onClick={() => runCheck(claim, quote)}
          className="rounded-xl bg-accent px-3.5 py-2 text-sm font-bold text-accent-ink transition-colors hover:bg-accent-strong disabled:opacity-40"
        >
          {typesafeStatus === "pending" ? "Checking…" : "Verify citation"}
        </button>
      </div>

      {(result || typesafeStatus !== "idle") && (() => {
        const oaRelationAnswer = openaiOutcome?.ok ? openaiOutcome.result.answers.relation : undefined;
        const oaStyle = oaRelationAnswer ? OPENAI_RELATION_STYLE[String(oaRelationAnswer.value)] : undefined;
        const summaryStats: SummaryStat[] = [];
        if (result?.relation) {
          summaryStats.push({ label: "confidence:", value: `${Math.round(result.relation.confidence * 100)}%` });
        }
        if (result && oaStyle) {
          const agree = result.verdict === oaStyle.verdict;
          summaryStats.push({ label: "agree:", value: agree ? "yes" : "no", tone: agree ? "emerald" : "rose" });
        }
        const headline = result ? (result.status === "missing" ? "Fabricated" : result.verdict) : "Checking…";
        return (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <EvalSummaryBar icon="search" headline={headline} stats={summaryStats} />
              {lastRun && (
                <RerunButton
                  onClick={() => runCheck(lastRun.claim, lastRun.quote, lastRun.sectionId)}
                  pending={typesafeStatus === "pending"}
                  label="Re-check"
                />
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
          <ActivityWindow title="TypeSafe" subtitle="locate → Choice" status={typesafeStatus} activityId={typesafeActivityId} accent="deep">
            {typesafeStatus === "pending" && <p className="text-sm font-medium text-secondary">Checking…</p>}
            {typesafeStatus === "error" && <p className="text-sm font-bold text-rose-800">That check failed. Try again.</p>}
            {result && typesafeStatus === "done" && (
              <div className={`space-y-3 rounded-xl border p-3 ${VERDICT_STYLES[result.verdict]}`}>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <span className="text-lg font-extrabold uppercase tracking-wide">{result.verdict}</span>
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-foreground/[0.06] px-2 py-0.5 text-xs font-bold">
                    {result.autoAccept ? "Auto-accepted" : "Needs human review"}
                  </span>
                </div>
                {result.status === "missing" ? (
                  <p className="text-sm opacity-90">The quote does not appear anywhere in the source - no model call needed.</p>
                ) : (
                  <>
                    <p className="text-sm opacity-90">
                      Located in section {result.sectionId} (
                      {result.status === "section-only" ? "named, no quote to match" : "quote matched verbatim"}).
                    </p>
                    {result.relation && (
                      <div className="space-y-1">
                        <ProbabilityBar
                          label={result.relation.choice}
                          value={result.relation.confidence}
                          tone={VERDICT_TONE[result.verdict]}
                          highlight
                        />
                        <p className="text-xs font-semibold">
                          calibrated confidence {Math.round(result.relation.confidence * 100)}%
                        </p>
                      </div>
                    )}
                    {result.sectionText && (
                      <details className="text-sm">
                        <summary className="cursor-pointer font-semibold">Show source section</summary>
                        <p className="mt-1 whitespace-pre-wrap rounded-lg bg-foreground/[0.06] p-2 font-mono text-xs leading-relaxed">
                          {result.sectionText}
                        </p>
                      </details>
                    )}
                  </>
                )}
              </div>
            )}
          </ActivityWindow>

          <ActivityWindow
            title="OpenAI"
            subtitle={openaiOutcome?.ok ? openaiOutcome.result.model : openaiConfigured ? "locate → function call" : "not configured"}
            status={openaiStatus}
            activityId={openaiActivityId}
            accent="violet"
          >
            {!openaiConfigured && (
              <p className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent-soft-ink">
                Set <code className="text-accent-soft-ink">OPENAI_API_KEY</code> to run this check against OpenAI too.
              </p>
            )}
            {openaiStatus === "pending" && <p className="text-sm font-medium text-secondary">Checking…</p>}
            {openaiStatus === "error" && <p className="text-sm font-bold text-rose-800">That call failed. Try again.</p>}
            {openaiStatus === "done" &&
              openaiOutcome?.ok &&
              (() => {
                const relationAnswer = openaiOutcome.result.answers.relation;
                const style = relationAnswer ? OPENAI_RELATION_STYLE[String(relationAnswer.value)] : undefined;
                return (
                  <div
                    className={`space-y-3 rounded-xl border p-3 ${
                      style ? VERDICT_STYLES[style.verdict] : "border-border bg-surface"
                    }`}
                  >
                    {relationAnswer && style ? (
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <span className="text-lg font-extrabold uppercase tracking-wide">{style.label}</span>
                        {relationAnswer.selfReportedConfidence != null && (
                          <span className="shrink-0 whitespace-nowrap rounded-full bg-foreground/[0.06] px-2 py-0.5 text-xs font-bold">
                            self-reported {Math.round(relationAnswer.selfReportedConfidence * 100)}%
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted">No relation answer returned.</p>
                    )}
                    <p className="text-xs font-semibold">
                      {Math.round(openaiOutcome.result.elapsedMs)} ms · {openaiOutcome.result.usage.input_tokens} in /{" "}
                      {openaiOutcome.result.usage.output_tokens} out tokens
                    </p>
                  </div>
                );
              })()}
            {openaiStatus === "done" && openaiOutcome && !openaiOutcome.ok && openaiOutcome.reason === "not_configured" && (
              <p className="text-sm text-muted">{openaiOutcome.message ?? "Nothing to compare (fabricated citation)."}</p>
            )}
            <OpenAINote outcome={openaiOutcome} />
          </ActivityWindow>
            </div>
            {result && result.status !== "missing" && (
              <EvaluationPanel
                kind="citation"
                typesafePacket={buildCitationPacket({
                  claim: lastRun?.claim ?? claim,
                  quote: (lastRun?.quote ?? quote).trim() || null,
                  verdict: result.verdict,
                  relation: result.relation ? RELATION_LABELS[result.relation.choice] ?? result.relation.choice : null,
                  sectionId: result.sectionId,
                  sectionText: result.sectionText,
                })}
                typesafeSource={result.source}
                openaiPacket={
                  oaStyle
                    ? buildCitationPacket({
                        claim: lastRun?.claim ?? claim,
                        quote: (lastRun?.quote ?? quote).trim() || null,
                        verdict: oaStyle.verdict,
                        relation: RELATION_LABELS[String(oaRelationAnswer?.value)] ?? String(oaRelationAnswer?.value),
                        sectionId: result.sectionId,
                        sectionText: result.sectionText,
                      })
                    : null
                }
                openaiConfigured={openaiConfigured}
                openaiEmptyReason={oaStyle || openaiStatus !== "done" ? undefined : noOpenAIAnswerReason(openaiOutcome, "the relation answer")}
              />
            )}
          </>
        );
      })()}
    </div>
  );
}
