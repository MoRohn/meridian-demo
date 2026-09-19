"use client";

import { useState, type ReactNode } from "react";
import { runEvaluation } from "@/lib/eval/client";
import { EVAL_KINDS } from "@/lib/eval/kinds";
import { describeHealth } from "@/lib/eval/health";
import { describeIntegrity } from "@/lib/eval/integrity";
import { useEvalHealth } from "@/lib/eval/useEvalHealth";
import { JUDGE_FAILURE_TITLES } from "@/lib/eval/serviceError";
import type { EvalPacket } from "@/lib/eval/packets";
import type { EvalKind, EvalOutcome, EvalResult } from "@/lib/eval/types";
import { Icon, type IconName } from "./Icon";
import { RerunButton } from "./RerunButton";

type Tone = "emerald" | "amber" | "rose";
type Backend = "typesafe" | "openai";

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
          {result.judgeModel} · rubric {result.rubric.id} v{result.rubric.version} · {(result.latencyMs / 1000).toFixed(1)}s
        </p>
      </div>

      {/* Messages */}
      <div className="space-y-2">
        <Message icon="chat" label="Judge's verdict">
          {result.reason}
        </Message>
        {integrity && (
          <Message icon="alert" label="Untrusted content detected" tone="warn">
            {integrity}
          </Message>
        )}
        <Disclosure summary="What the judge saw">
          <p className="mb-1 font-bold text-deep">Request</p>
          <pre className="mb-2 whitespace-pre-wrap font-sans">{packet.input}</pre>
          <p className="mb-1 font-bold text-deep">Answer under evaluation</p>
          <pre className="mb-2 whitespace-pre-wrap font-sans">{packet.actualOutput}</pre>
          <p className="font-bold text-deep">Source text</p>
          <p>{packet.context ? `${packet.context.length.toLocaleString()} characters, passed as fenced, untrusted data.` : "None."}</p>
        </Disclosure>
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
  /** Set when this side must not be evaluated, with the reader-facing reason. */
  skipReason: string | null;
}

interface Stored {
  sig: string;
  outcome: EvalOutcome | null;
  pending: boolean;
}

function SideCard({ side, stored, sig }: { side: Side; stored: Stored | undefined; sig: string }) {
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
        No answer from this backend yet.
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
      <StatusCard name={side.name} icon="alert" tone="warn" title="Evaluation service unavailable">
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
  typesafePacket,
  typesafeSource,
  openaiPacket,
  openaiConfigured,
}: {
  kind: EvalKind;
  typesafePacket: EvalPacket | null;
  /** Where the TypeSafe answer came from; only "live" answers are evaluated. */
  typesafeSource: "live" | "mock" | null;
  openaiPacket: EvalPacket | null;
  openaiConfigured: boolean;
}) {
  const [stored, setStored] = useState<Partial<Record<Backend, Stored>>>({});
  const copy = EVAL_KINDS[kind];
  const { health, refresh } = useEvalHealth();
  const status = health ? describeHealth(health) : null;

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
      skipReason: openaiConfigured ? null : "OpenAI isn't configured, so there is no OpenAI answer to evaluate.",
    },
  ];
  const sigOf = (s: Side) => (s.packet ? JSON.stringify([s.packet.input, s.packet.actualOutput, s.packet.context?.length ?? 0]) : "");
  const runnable = sides.filter((s) => s.packet && !s.skipReason);
  const anyPending = sides.some((s) => stored[s.backend]?.pending);
  const hasRun = sides.some((s) => stored[s.backend]?.outcome);

  function run() {
    for (const side of runnable) {
      const sig = sigOf(side);
      const packet = side.packet!;
      setStored((prev) => ({ ...prev, [side.backend]: { sig, outcome: null, pending: true } }));
      runEvaluation({ kind, backend: side.backend, input: packet.input, actualOutput: packet.actualOutput, context: packet.context }).then((outcome) =>
        {
          setStored((prev) => ({ ...prev, [side.backend]: { sig, outcome, pending: false } }));
          if (!outcome.ok) refresh(); // a failed run may mean the service state changed; re-check it
        },
      );
    }
  }

  return (
    <section aria-label={copy.title} className="space-y-3 rounded-xl border border-border bg-elevated/50 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-deep">
            <Icon name="flask" size={16} />
            {copy.title}
            <span className="rounded border border-border-strong px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-muted">DeepEval G-Eval</span>
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">{copy.subtitle}</p>
        </div>
        {runnable.length > 0 && <RerunButton onClick={run} pending={anyPending} label={hasRun ? "Re-evaluate" : "Evaluate"} />}
      </div>
      {status && (
        <p role="status" className="flex items-center gap-2 text-xs font-semibold text-secondary">
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${status.tone === "ok" ? "bg-emerald-600" : status.tone === "warn" ? "bg-amber-600" : "bg-rose-600"}`}
          />
          {status.text}
        </p>
      )}
      <p className="text-xs text-muted">
        Independent LLM judge. Scores measure whether an answer is correct and supported by the text, not how confident the model was.
      </p>
      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
        {sides.map((side) => (
          <SideCard key={side.backend} side={side} stored={stored[side.backend]} sig={sigOf(side)} />
        ))}
      </div>
    </section>
  );
}
