"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { runEvaluation } from "@/lib/eval/client";
import { EVAL_KINDS } from "@/lib/eval/kinds";
import { describeHealth } from "@/lib/eval/health";
import { describeIntegrity } from "@/lib/eval/integrity";
import { shouldAutoEvaluate } from "@/lib/eval/auto";
import { savedJudgeKey } from "@/lib/eval/client";
import { evalStore, type Backend, type StoredEvaluation } from "@/lib/eval/store";
import { autoEvaluateEnabled } from "@/lib/settings";
import { useIsRendered } from "@/lib/useIsRendered";
import { renderBold } from "@/lib/renderBold";
import { activityLog, formatElapsed } from "@/lib/activity/log";
import { bandFor, describeMatchup } from "@/lib/compare/performance";
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

/** One standardized message row: a small labelled icon beside the message body. */
function Message({ icon, label, tone = "neutral", children }: { icon: IconName; label: string; tone?: "neutral" | "warn" | "error"; children: ReactNode }) {
  const styles =
    tone === "warn"
      ? "border-amber-600/30 bg-amber-600/[0.08] text-amber-900"
      : tone === "error"
        ? "border-rose-600/30 bg-rose-600/[0.06] text-rose-900"
        : "border-border bg-elevated/70 text-secondary";
  return (
    <div className={`flex gap-2.5 rounded-lg border px-3 py-2.5 ${styles}`}>
      <Icon name={icon} size={16} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide opacity-80">{label}</p>
        <div className="mt-0.5 text-sm leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-elevated px-2 py-1.5">
      <dt className="truncate text-[11px] font-bold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 font-bold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted transition-colors hover:text-deep">
        {summary}
        <Icon name="chevron" size={14} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-3 py-2.5 text-xs leading-relaxed text-secondary">{children}</div>
    </details>
  );
}

function CardShell({ name, badge, children }: { name: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={`${name} evaluation`} className="min-w-0 space-y-3 rounded-xl border border-border bg-surface p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted">{name}</h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

function ResultCard({ name, result, packet }: { name: string; result: EvalResult; packet: EvalPacket }) {
  const tone = scoreTone(result.score, result.threshold);
  const t = TONE[tone];
  const integrity = describeIntegrity(result);
  const score = Math.round(result.score * 100);
  const band = bandFor(result);
  return (
    <CardShell
      name={name}
      badge={
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${t.chip}`}>
          <Icon name={result.success ? "check" : "x"} size={12} />
          {result.success ? "Pass" : "Fail"}
        </span>
      }
    >
      {/* Metrics */}
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className={`text-3xl font-extrabold tabular-nums tracking-tight ${t.text}`}>
            {score}
            <span className="text-lg">%</span>
          </span>
          <span className="text-xs text-muted">pass at {Math.round(result.threshold * 100)}%</span>
        </div>
        <div
          className="relative mt-1.5 h-1.5 w-full rounded-full bg-border"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={score}
          aria-label={`${name} evaluation score`}
        >
          <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${score}%` }} />
          <div className="absolute -top-0.5 h-2.5 w-0.5 rounded bg-deep/60" style={{ left: `${result.threshold * 100}%` }} aria-hidden />
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {result.judgeModel} · rubric {result.rubric.id} v{result.rubric.version}
        </p>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <Metric label="Judge score" value={`${Math.round(result.score * 10)}/10`} />
          <Metric label="Judge time" value={formatElapsed(result.latencyMs)} />
          <Metric label="Judge cost" value={result.judgeCostUsd != null ? fmtUsd(result.judgeCostUsd) : "n/a"} />
        </dl>
      </div>

      {/* Messages */}
      <div className="space-y-2">
        <Message icon="chat" label="Judge's verdict">
          {result.reason}
        </Message>
        {band && (
          <Message icon="info" label={`What ${band.points}/10 means`}>
            Band {band.low}&ndash;{band.high}: {band.outcome}
          </Message>
        )}
        {integrity && (
          <Message icon="alert" label="Untrusted content detected" tone="warn">
            {integrity}
          </Message>
        )}
        <Disclosure summary="What the judge saw">
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
        </Disclosure>
        {result.bands.length > 0 && (
          <Disclosure summary="Score bands for this rubric">
            <ul className="space-y-1.5">
              {result.bands.map((b) => (
                <li key={b.low} className={b === band ? "font-bold text-deep" : undefined}>
                  <span className="tabular-nums">{b.low}&ndash;{b.high}</span>: {b.outcome}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        <Disclosure summary={`How it was judged (${result.steps.length} steps)`}>
          <ol className="list-decimal space-y-1.5 pl-4">
            {result.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </Disclosure>
      </div>
    </CardShell>
  );
}

function StatusCard({ name, icon, tone, title, children }: { name: string; icon: IconName; tone: "neutral" | "warn" | "error"; title: string; children: ReactNode }) {
  return (
    <CardShell name={name}>
      <Message icon={icon} label={title} tone={tone}>
        {children}
      </Message>
    </CardShell>
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

function SideCard({ side, stored, sig, serviceDown }: { side: Side; stored: StoredEvaluation | undefined; sig: string; serviceDown: boolean }) {
  if (side.skipReason) {
    return (
      <StatusCard name={side.name} icon="info" tone="neutral" title="Not evaluated">
        {side.skipReason}
      </StatusCard>
    );
  }
  if (!side.packet) {
    return (
      <StatusCard name={side.name} icon="info" tone="neutral" title="Nothing to evaluate">
        {side.emptyReason ?? "No answer from this backend yet."}
      </StatusCard>
    );
  }
  // The service being down is said once, in the status line above, with the command to fix it. The cards stay calm.
  if (serviceDown) {
    return (
      <StatusCard name={side.name} icon="info" tone="neutral" title="Waiting for the evaluation service">
        This answer will be evaluated once the service is running.
      </StatusCard>
    );
  }
  const current = stored && stored.sig === sig ? stored : undefined;
  if (current?.pending) {
    return (
      <StatusCard name={side.name} icon="loader" tone="neutral" title="Judging">
        The judge is re-deriving the answer from the source text&hellip;
      </StatusCard>
    );
  }
  if (!current?.outcome) {
    return (
      <StatusCard name={side.name} icon="info" tone="neutral" title={stored ? "Answer changed" : "Not evaluated yet"}>
        {stored ? "This answer changed since it was last evaluated. Re-evaluate to score the current answer." : "Select Evaluate to score this answer."}
      </StatusCard>
    );
  }
  const { outcome } = current;
  if (!outcome.ok) {
    return outcome.reason === "not_configured" ? (
      <StatusCard name={side.name} icon="alert" tone="warn" title="Judge not configured">
        {outcome.message ?? "The evaluation service isn't configured."}
      </StatusCard>
    ) : (
      <StatusCard name={side.name} icon="alert" tone="error" title={(outcome.code && JUDGE_FAILURE_TITLES[outcome.code]) || "Judge call failed"}>
        {outcome.message ?? "The judge call failed."}
        {outcome.code && <span className="mt-1 block font-mono text-[11px] opacity-90">{outcome.code}</span>}
      </StatusCard>
    );
  }
  return <ResultCard name={side.name} result={outcome.result} packet={side.packet} />;
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
  const status = health ? describeHealth(health, { savedKey: Boolean(savedJudgeKey()) }) : null;

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
  const hasSavedKey = Boolean(savedJudgeKey());
  const serviceDown = health?.status === "offline" || lastRunOffline;
  const keyMissing = health?.status === "judge_not_configured" && !hasSavedKey;
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
      health: health?.status ?? null,
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

  const ranAutomatically = Object.values(stored).some((e) => e?.auto && e.outcome?.ok);
  // Both answers judged on the same request and sources: say which was better and by how much.
  const tsOutcome = stored.typesafe?.outcome;
  const oaOutcome = stored.openai?.outcome;
  const tsCurrent = stored.typesafe?.sig === sigOf(sides[0]) && tsOutcome?.ok;
  const oaCurrent = stored.openai?.sig === sigOf(sides[1]) && oaOutcome?.ok;
  const matchup =
    tsCurrent && oaCurrent && tsOutcome?.ok && oaOutcome?.ok
      ? (() => {
          const delta = Math.round((tsOutcome.result.score - oaOutcome.result.score) * 100);
          const winner = Math.abs(tsOutcome.result.score - oaOutcome.result.score) <= 0.03 ? ("tie" as const) : delta > 0 ? ("typesafe" as const) : ("openai" as const);
          return { typesafe: tsOutcome.result, openai: oaOutcome.result, delta, winner };
        })()
      : null;

  return (
    <section ref={sectionRef} aria-label={copy.title} className="space-y-3 rounded-xl border border-border bg-elevated/50 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-deep">
            <Icon name="flask" size={16} />
            {copy.title}
            <span className="rounded border border-border-strong px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-muted">DeepEval G-Eval</span>
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">{copy.subtitle}</p>
        </div>
        {runnable.length > 0 && (
          <RerunButton
            onClick={() => startRun(false)}
            pending={anyPending}
            label={buttonLabel}
            disabled={keyMissing}
            title={keyMissing ? "Save an OpenAI key in Settings, or set OPENAI_API_KEY for the evaluation service" : undefined}
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
      {ranAutomatically && (
        <p className="text-xs font-semibold text-muted">Evaluated automatically the first time you opened this. Re-evaluate to run it again.</p>
      )}
      <p className="text-xs text-muted">
        Independent LLM judge. Scores measure whether an answer is correct and supported by the text, not how confident the model was.
      </p>
      {matchup && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground">
          <Icon name="scale" size={16} className="mt-0.5 shrink-0 text-deep" />
          <span>
            <span className="text-xs font-bold uppercase tracking-wide text-muted">Head to head </span>
            {describeMatchup(matchup)}
          </span>
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
        {sides.map((side) => (
          <SideCard key={side.backend} side={side} stored={stored[side.backend]} sig={sigOf(side)} serviceDown={serviceDown} />
        ))}
      </div>
    </section>
  );
}
