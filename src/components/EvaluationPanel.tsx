"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { runEvaluation } from "@/lib/eval/client";
import { EVAL_KINDS } from "@/lib/eval/kinds";
import { describeHealth, judgeKeyAvailable } from "@/lib/eval/health";
import { describeIntegrity } from "@/lib/eval/integrity";
import { shouldAutoEvaluate } from "@/lib/eval/auto";
import { savedJudgeKey } from "@/lib/eval/client";
import { evalStore, type Backend, type StoredEvaluation } from "@/lib/eval/store";
import { autoEvaluateEnabled, describeJudge, loadSettings } from "@/lib/settings";
import { useIsRendered } from "@/lib/useIsRendered";
import { renderBold } from "@/lib/renderBold";
import { activityLog, formatElapsed } from "@/lib/activity/log";
import { bandFor, compareScores, describeMatchup } from "@/lib/compare/performance";
import { fmtUsd } from "@/lib/compare/pricing";
import { useEvalHealth } from "@/lib/eval/useEvalHealth";
import { JUDGE_FAILURE_TITLES } from "@/lib/eval/serviceError";
import type { EvalPacket } from "@/lib/eval/packets";
import type { EvalKind, EvalOutcome, EvalResult } from "@/lib/eval/types";
import { Icon, type IconName } from "./Icon";
import { RerunButton } from "./RerunButton";

/** Sources up to this long are kept with a result so a report can quote them; longer ones (a whole contract) are only counted. */
const SHORT_SOURCE_CHARS = 2000;

type Tone = "emerald" | "amber" | "rose";

const TONE = {
  emerald: { text: "text-emerald-800", bar: "bg-emerald-600", chip: "border-emerald-600/30 bg-emerald-600/10 text-emerald-800" },
  amber: { text: "text-amber-800", bar: "bg-amber-600", chip: "border-amber-600/30 bg-amber-600/10 text-amber-800" },
  rose: { text: "text-rose-800", bar: "bg-rose-600", chip: "border-rose-600/30 bg-rose-600/10 text-rose-800" },
} as const;

function scoreTone(score: number, threshold: number): Tone {
  return score >= Math.max(0.8, threshold) ? "emerald" : score >= threshold ? "amber" : "rose";
}

function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-border bg-surface">
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted transition-colors hover:text-deep">
        {summary}
        <Icon name="chevron" size={14} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-3 py-2.5 text-xs leading-relaxed text-secondary">{children}</div>
    </details>
  );
}

/** What the judge was shown: the request, the answer under evaluation, and the source text (or how much of it). */
function SawContent({ packet }: { packet: EvalPacket }) {
  return (
    <>
      <p className="mb-1 font-bold text-deep">Request</p>
      <pre className="mb-2 whitespace-pre-wrap font-sans">{packet.input}</pre>
      <p className="mb-1 font-bold text-deep">Answer under evaluation</p>
      <pre className="mb-2 whitespace-pre-wrap font-sans">{renderBold(packet.actualOutput)}</pre>
      <p className="font-bold text-deep">Source text</p>
      {packet.context ? (
        <>
          <p className="mb-1 text-muted">
            {packet.context.length.toLocaleString()} characters, passed as fenced, untrusted data. Both backends are judged against this
            same source text; only the answer differs.
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-elevated/60 p-2 font-sans" tabIndex={0}>
            {packet.context}
          </pre>
        </>
      ) : (
        <p>None.</p>
      )}
    </>
  );
}

function BandsContent({ result, band }: { result: EvalResult; band: ReturnType<typeof bandFor> }) {
  return (
    <ul className="space-y-1.5">
      {result.bands.map((b) => (
        <li key={b.low} className={band && b.low === band.low ? "font-bold text-deep" : undefined}>
          <span className="tabular-nums">{b.low}&ndash;{b.high}</span>: {b.outcome}
        </li>
      ))}
    </ul>
  );
}

function StepsContent({ result }: { result: EvalResult }) {
  return (
    <ol className="list-decimal space-y-1.5 pl-4">
      {result.steps.map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>
  );
}

interface Side {
  name: string;
  backend: Backend;
  packet: EvalPacket | null;
  /** Why there is no packet when it will never arrive (a failed or incomplete call); otherwise the answer is just pending. */
  emptyReason?: string;
  /** Set when this side must not be evaluated, with the reader-facing reason. */
  skipReason: string | null;
}

/** What one model's evaluation slot has to say right now: a score, or the reason there isn't one. Both layouts render this, so they cannot disagree. */
type SideView =
  | { kind: "status"; icon: IconName; tone: "neutral" | "warn" | "error"; title: string; body: ReactNode }
  | { kind: "result"; result: EvalResult; packet: EvalPacket };

function viewOf(side: Side, stored: StoredEvaluation | undefined, sig: string, serviceDown: boolean): SideView {
  if (side.skipReason) return { kind: "status", icon: "info", tone: "neutral", title: "Not evaluated", body: side.skipReason };
  if (!side.packet) return { kind: "status", icon: "info", tone: "neutral", title: "Nothing to evaluate", body: side.emptyReason ?? "No answer from this backend yet." };
  // The service being down is said once, in the status line above, with the command to fix it. The cards stay calm.
  if (serviceDown) return { kind: "status", icon: "info", tone: "neutral", title: "Waiting for the evaluation service", body: "This answer will be evaluated once the service is running." };
  const current = stored && stored.sig === sig ? stored : undefined;
  if (current?.pending) return { kind: "status", icon: "loader", tone: "neutral", title: "Judging", body: "The judge is re-deriving the answer from the source text\u2026" };
  if (!current?.outcome) {
    return {
      kind: "status",
      icon: "info",
      tone: "neutral",
      title: stored ? "Answer changed" : "Not evaluated yet",
      body: stored ? "This answer changed since it was last evaluated. Re-evaluate to score the current answer." : "Select Evaluate to score this answer.",
    };
  }
  const { outcome } = current;
  if (!outcome.ok) {
    return outcome.reason === "not_configured"
      ? { kind: "status", icon: "alert", tone: "warn", title: "Judge not configured", body: outcome.message ?? "The evaluation service isn't configured." }
      : {
          kind: "status",
          icon: "alert",
          tone: "error",
          title: (outcome.code && JUDGE_FAILURE_TITLES[outcome.code]) || "Judge call failed",
          body: (
            <>
              {outcome.message ?? "The judge call failed."}
              {outcome.code && <span className="mt-1 block font-mono text-[11px] opacity-90">{outcome.code}</span>}
            </>
          ),
        };
  }
  return { kind: "result", result: outcome.result, packet: side.packet };
}

/**
 * The evaluation layout, the same on every tab: one row per model in a single table (score, result, judge time and cost), the judge's verdict on the
 * line beneath, and everything longer (what the judge saw, bands, steps) in one disclosure below. It says the same things as
 * the full cards, in a fraction of the space.
 */
function CompactSides({ sides, stored, sigOf, serviceDown }: { sides: Side[]; stored: Partial<Record<Backend, StoredEvaluation>>; sigOf: (s: Side) => string; serviceDown: boolean }) {
  const views = sides.map((side) => ({ side, view: viewOf(side, stored[side.backend], sigOf(side), serviceDown) }));
  const results = views.filter((v): v is { side: Side; view: Extract<SideView, { kind: "result" }> } => v.view.kind === "result");
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table aria-label="Evaluation scores" className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-elevated text-left text-[11px] font-bold uppercase tracking-wide text-muted">
              <th scope="col" className="px-2.5 py-1.5">Model</th>
              <th scope="col" className="px-2 py-1.5">Score</th>
              <th scope="col" className="px-2 py-1.5">Result</th>
              <th scope="col" className="px-2 py-1.5">Judge time</th>
              <th scope="col" className="px-2 py-1.5">Judge cost</th>
            </tr>
          </thead>
          {views.map(({ side, view }) => (
            <tbody key={side.backend} aria-label={`${side.name} evaluation`} className="border-t border-border/60 first:border-t-0">
              {view.kind === "result" ? (
                <CompactResultRows name={side.name} result={view.result} />
              ) : (
                <tr>
                  <th scope="row" className="px-2.5 py-2 text-left align-top font-bold text-foreground">{side.name}</th>
                  <td colSpan={4} className={`px-2 py-2 ${view.tone === "error" ? "text-rose-900" : view.tone === "warn" ? "text-amber-900" : "text-secondary"}`}>
                    <span className="inline-flex items-start gap-1.5">
                      <Icon name={view.icon} size={13} className="mt-0.5" />
                      <span>
                        <span className="font-bold">{view.title}. </span>
                        {view.body}
                      </span>
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          ))}
        </table>
      </div>
      {results.length > 0 && (
        <Disclosure summary="Judge details: what it saw, score bands and steps">
          <div className="space-y-4">
            {results.map(({ side, view }) => (
              <div key={side.backend}>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">
                  {side.name} &middot; {view.result.judgeModel} &middot; rubric {view.result.rubric.id} v{view.result.rubric.version}
                </p>
                <SawContent packet={view.packet} />
                {view.result.bands.length > 0 && (
                  <>
                    <p className="mb-1 mt-2 font-bold text-deep">Score bands</p>
                    <BandsContent result={view.result} band={bandFor(view.result)} />
                  </>
                )}
                <p className="mb-1 mt-2 font-bold text-deep">How it was judged ({view.result.steps.length} steps)</p>
                <StepsContent result={view.result} />
              </div>
            ))}
          </div>
        </Disclosure>
      )}
    </div>
  );
}

function CompactResultRows({ name, result }: { name: string; result: EvalResult }) {
  const t = TONE[scoreTone(result.score, result.threshold)];
  const integrity = describeIntegrity(result);
  const score = Math.round(result.score * 100);
  const band = bandFor(result);
  return (
    <>
      <tr className="align-top">
        <th scope="row" className="px-2.5 pt-2 text-left font-bold text-foreground">{name}</th>
        <td className="px-2 pt-2">
          <span className={`text-sm font-extrabold tabular-nums ${t.text}`}>{score}%</span>
          <span
            className="relative mt-1 block h-1 w-16 rounded-full bg-border"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={score}
            aria-label={`${name} evaluation score`}
          >
            <span className={`block h-full rounded-full ${t.bar}`} style={{ width: `${score}%` }} />
            <span className="absolute -top-0.5 h-2 w-0.5 rounded bg-deep/60" style={{ left: `${result.threshold * 100}%` }} aria-hidden />
          </span>
        </td>
        <td className="px-2 pt-2">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold ${t.chip}`}>
            <Icon name={result.success ? "check" : "x"} size={11} />
            {result.success ? "Pass" : "Fail"}
          </span>
          <span className="mt-0.5 block text-[11px] text-muted">at {Math.round(result.threshold * 100)}%</span>
        </td>
        <td className="px-2 pt-2 tabular-nums text-secondary">{formatElapsed(result.latencyMs)}</td>
        <td className="px-2 pt-2 tabular-nums text-secondary">{result.judgeCostUsd != null ? fmtUsd(result.judgeCostUsd) : "n/a"}</td>
      </tr>
      <tr>
        <td colSpan={5} className="px-2.5 pb-2 pt-1 leading-relaxed text-secondary">
          <span className="font-bold text-muted">Verdict: </span>
          <span data-verdict>{result.reason}</span>
          {band && (
            <span className="mt-0.5 block text-muted">
              {band.points}/10 &middot; band {band.low}&ndash;{band.high}: {band.outcome}
            </span>
          )}
          {integrity && (
            <span className="mt-1 flex items-start gap-1.5 rounded border border-amber-600/30 bg-amber-600/[0.08] px-2 py-1 text-amber-900">
              <Icon name="alert" size={13} className="mt-0.5" />
              <span>{integrity}</span>
            </span>
          )}
        </td>
      </tr>
    </>
  );
}

/**
 * The standardized evaluation surface used by every tab: an independent
 * DeepEval (G-Eval) judgment of each backend's answer. Header = what is being
 * judged and why (title + subtitle); each backend card puts the metrics first
 * and the messages (verdict, integrity notice, evidence, method) below them.
 *
 * Two rules keep the scores honest: the local demo heuristic is never
 * evaluated as if it were TypeSafe, and a result is only shown against the
 * exact answer it judged (a changed answer prompts a re-evaluation).
 */
export function EvaluationPanel({
  kind,
  scope = kind,
  typesafePacket,
  typesafeSource,
  openaiPacket,
  openaiConfigured,
  openaiEmptyReason,
}: {
  kind: EvalKind;
  /** Names this evaluation surface for the session store. Defaults to the kind; an excerpt panel passes its own so it has its own first time. */
  scope?: string;
  typesafePacket: EvalPacket | null;
  /** Where the TypeSafe answer came from; only "live" answers are evaluated. */
  typesafeSource: "live" | "mock" | null;
  openaiPacket: EvalPacket | null;
  openaiConfigured: boolean;
  /** When OpenAI has no answer to evaluate and never will (its call failed, or came back incomplete), why. */
  openaiEmptyReason?: string;
}) {
  // Results live in a session store, not in this component: the tab remounts when you switch away and back, and a result
  // (or a paid judge call still in flight) must survive that.
  useSyncExternalStore(evalStore.subscribe, evalStore.version, () => 0);
  const stored: Partial<Record<Backend, StoredEvaluation>> = { typesafe: evalStore.get(scope, "typesafe"), openai: evalStore.get(scope, "openai") };
  const sectionRef = useRef<HTMLElement>(null);
  const rendered = useIsRendered(sectionRef);
  const [gaveUpWaiting, setGaveUpWaiting] = useState(false);
  const copy = EVAL_KINDS[kind];
  const { health, refresh } = useEvalHealth();
  // Who judges is whatever the Settings modal says: the saved OpenAI key by default, or the Claude, Gemini or OpenAI judge picked there.
  const judgeChoice = describeJudge(loadSettings());
  const hasSavedKey = Boolean(savedJudgeKey());
  const status = health ? describeHealth(health, { savedKey: hasSavedKey, judge: judgeChoice }) : null;

  const sides: Side[] = [
    {
      name: "TypeSafe",
      backend: "typesafe",
      packet: typesafePacket,
      skipReason:
        typesafePacket && typesafeSource !== "live"
          ? "This answer came from the local demo heuristic, not the live TypeSafe model, so it isn't evaluated. Add a TypeSafe API key in Settings to evaluate real answers."
          : null,
    },
    {
      name: "OpenAI",
      backend: "openai",
      packet: openaiPacket,
      emptyReason: openaiEmptyReason,
      skipReason: openaiConfigured ? null : "OpenAI isn't configured, so there is no OpenAI answer to evaluate.",
    },
  ];
  const sigOf = (s: Side) => (s.packet ? JSON.stringify([s.packet.input, s.packet.actualOutput, s.packet.context?.length ?? 0]) : "");
  const runnable = sides.filter((s) => s.packet && !s.skipReason);
  const anyPending = sides.some((s) => stored[s.backend]?.pending);
  const outcomes = sides.map((s) => stored[s.backend]?.outcome).filter((o): o is EvalOutcome => Boolean(o));
  const hasResult = outcomes.some((o) => o.ok);
  const lastRunOffline = outcomes.some((o) => !o.ok && o.code === "service_offline");

  // One reading of the situation, so the button, the status line and the cards can never disagree.
  const serviceDown = health?.status === "offline" || lastRunOffline;
  const keyMissing = health != null && health.status !== "offline" && !judgeKeyAvailable(health, judgeChoice.provider, hasSavedKey);
  // For deciding whether to evaluate by itself: a chosen judge with no key is the same as no judge, whatever the service's OpenAI state says.
  const autoHealth = health == null ? null : keyMissing ? ("judge_not_configured" as const) : health.status;
  const buttonLabel = serviceDown ? "Check again" : hasResult ? "Re-evaluate" : outcomes.length > 0 ? "Try again" : "Evaluate";
  const statusText = lastRunOffline && health?.status !== "offline" ? describeHealth({ status: "offline" }).text : status?.text;

  function startRun(auto: boolean) {
    if (serviceDown && !auto) {
      // Nothing to send while it is down: look again, and clear the stale failure so the status can recover.
      evalStore.clearScope(scope);
      refresh();
      return;
    }
    for (const side of runnable) {
      const sig = sigOf(side);
      const packet = side.packet!;
      const snapshot = {
        input: packet.input,
        actualOutput: packet.actualOutput,
        contextChars: packet.context?.length ?? 0,
        context: packet.context && packet.context.length <= SHORT_SOURCE_CHARS ? packet.context : undefined,
      };
      evalStore.set(scope, side.backend, { sig, outcome: null, pending: true, auto, kind, packet: snapshot });
      // Each judge call is its own activity with its own timer, so it starts from zero whatever else is running.
      const activityId = activityLog.begin("judge", "evaluation", `${copy.title}: ${side.name}`);
      runEvaluation({ kind, backend: side.backend, input: packet.input, actualOutput: packet.actualOutput, context: packet.context }).then((outcome) => {
        evalStore.set(scope, side.backend, { sig, outcome, pending: false, auto, kind, packet: snapshot });
        activityLog.finish(
          activityId,
          outcome.ok
            ? { status: "done", modelMs: outcome.result.latencyMs, model: outcome.result.judgeModel, score: outcome.result.score, costUsd: outcome.result.judgeCostUsd ?? undefined }
            : { status: "error", note: outcome.message ?? outcome.code },
        );
        if (!outcome.ok) refresh(); // a failed run may mean the service state changed; re-check it
      });
    }
  }

  // First time an action is open, evaluate it without a click. Waits for the other backend's answer so it isn't left
  // out, but not forever: if that answer never arrives, go ahead with what there is.
  const awaitingOther = openaiConfigured && !openaiPacket && !openaiEmptyReason;
  useEffect(() => {
    if (!(rendered && awaitingOther)) return;
    const timer = setTimeout(() => setGaveUpWaiting(true), 12_000);
    return () => clearTimeout(timer);
  }, [rendered, awaitingOther]);

  useEffect(() => {
    const go = shouldAutoEvaluate({
      enabled: autoEvaluateEnabled(),
      rendered,
      health: autoHealth,
      hasSavedKey,
      alreadyAutoRan: evalStore.autoRanFor(scope),
      hasEntries: evalStore.hasAny(scope),
      runnableCount: runnable.length,
      awaitingOtherSide: awaitingOther && !gaveUpWaiting,
    });
    if (!go) return;
    evalStore.markAutoRan(scope); // synchronously, before starting, so a double render cannot start it twice
    startRun(true);
  });

  // Both answers judged on the same request and sources: say which was better and by how much.
  const tsOutcome = stored.typesafe?.outcome;
  const oaOutcome = stored.openai?.outcome;
  const tsCurrent = stored.typesafe?.sig === sigOf(sides[0]) && tsOutcome?.ok;
  const oaCurrent = stored.openai?.sig === sigOf(sides[1]) && oaOutcome?.ok;
  const matchup =
    tsCurrent && oaCurrent && tsOutcome?.ok && oaOutcome?.ok
      ? (() => {
          const { delta, winner } = compareScores(tsOutcome.result.score, oaOutcome.result.score);
          return { typesafe: tsOutcome.result, openai: oaOutcome.result, delta, winner };
        })()
      : null;

  return (
    <section ref={sectionRef} aria-label={copy.title} className="space-y-2 rounded-xl border border-border bg-elevated/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-extrabold text-deep" title={copy.subtitle}>
            <Icon name="flask" size={16} />
            {copy.title}
            <span className="rounded border border-border-strong px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-muted">DeepEval G-Eval</span>
          </h2>
        </div>
        {runnable.length > 0 && (
          <RerunButton
            onClick={() => startRun(false)}
            pending={anyPending}
            label={buttonLabel}
            disabled={keyMissing}
            title={keyMissing ? `Add a ${judgeChoice.label} key in Settings (${judgeChoice.provider === "openai" ? "or set OPENAI_API_KEY for the evaluation service" : "under Judge model"})` : undefined}
          />
        )}
      </div>
      {status && (
        <p role="status" className="flex items-center gap-2 text-xs font-semibold text-secondary">
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${serviceDown ? "bg-rose-600" : status.tone === "ok" ? "bg-emerald-600" : status.tone === "warn" ? "bg-amber-600" : "bg-rose-600"}`}
          />
          {statusText}
        </p>
      )}
      {matchup && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-foreground">
          <Icon name="scale" size={16} className="mt-0.5 shrink-0 text-deep" />
          <span>
            <span className="text-xs font-bold uppercase tracking-wide text-muted">Head to head </span>
            {describeMatchup(matchup)}
          </span>
        </p>
      )}
      <CompactSides sides={sides} stored={stored} sigOf={sigOf} serviceDown={serviceDown} />
    </section>
  );
}
