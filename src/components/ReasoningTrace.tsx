import type { TraceEntry } from "@/lib/orchestrator/run";
import type { OpenAIRunOutcome } from "@/lib/openai/types";
import type { SessionTotals } from "@/lib/compare/pricing";
import { fmtUsd } from "@/lib/compare/pricing";
import { agrees, agreementSummary, openaiAnswerFor, typesafeSummary } from "@/lib/compare/agreement";
import { ProbabilityBar } from "./ProbabilityBar";
import { OpenAINote } from "./OpenAINote";
import { RerunButton } from "./RerunButton";
import { EvalSummaryBar } from "./EvalSummaryBar";
import { EvaluationPanel } from "./EvaluationPanel";

const REPLY_CRITERIA =
  "Given the document text in context, assess whether the reply is well-reasoned, grounded in the " +
  "actual document content, and correctly reflects the underlying judgments rather than making " +
  "unsupported claims.";

const SKILL_LABELS: Record<string, string> = {
  guardrails: "Guardrails",
  intake_router: "Intake Router",
  contract_type: "Contract Type",
  clause_risk: "Clause Risk",
  compliance_guard: "Compliance Guard",
};

export function ReasoningTrace({
  trace,
  source,
  openaiOutcome,
  openaiConfigured,
  sessionTotals,
  onRerun,
  rerunPending,
  lastMessage,
  lastReply,
  documentText,
}: {
  trace: TraceEntry[];
  source: "live" | "mock";
  openaiOutcome: OpenAIRunOutcome | null;
  openaiConfigured: boolean;
  sessionTotals: SessionTotals;
  /** Re-sends the last chat message to refresh this trace. Omitted (no button shown) until at least one message has been sent. */
  onRerun?: () => void;
  rerunPending?: boolean;
  /** The user message and composed reply behind the trace currently shown — evaluated by DeepEval below. OpenAI has no equivalent composed reply in this architecture (it only answers the structured questions), so only TypeSafe's side is judged here. */
  lastMessage?: string | null;
  lastReply?: string | null;
  documentText?: string | null;
}) {
  if (trace.length === 0) {
    return (
      <p className="text-base text-secondary">
        Send a message to see the Jev call: every applicable skill&rsquo;s questions, asked together in one
        request, with the answers your code actually used highlighted, and right next to each one, what OpenAI
        returns for the identical question.
      </p>
    );
  }

  const usedEntries = trace.filter((e) => e.used);
  const unusedEntries = trace.filter((e) => !e.used);
  const { agreed, compared } = agreementSummary(trace, openaiOutcome);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <EvalSummaryBar
          icon="🧠"
          headline={`${trace.length} question${trace.length === 1 ? "" : "s"} in one call`}
          stats={[
            { label: "used:", value: `${usedEntries.length}/${trace.length}` },
            compared > 0
              ? { label: "agree:", value: `${agreed}/${compared}`, tone: agreed === compared ? "emerald" : agreed === 0 ? "rose" : "amber" }
              : { label: "agree:", value: "n/a" },
            { label: "model:", value: source === "live" ? "live" : "mock", tone: source === "live" ? "emerald" : "amber" },
          ]}
        />
        {onRerun && <RerunButton onClick={onRerun} pending={Boolean(rerunPending)} label="Re-scan" />}
      </div>
      <p className="text-xs text-muted">
        Every applicable skill&rsquo;s questions, asked together in one request. Speculative questions not needed for
        this turn&rsquo;s reply are collapsed below rather than hidden.
      </p>

      {!openaiConfigured && (
        <p className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent-ink">
          Set <code className="text-accent-ink">OPENAI_API_KEY</code> to see OpenAI&rsquo;s answer next to every
          judgment below.
        </p>
      )}
      <OpenAINote outcome={openaiOutcome} />

      <ul className="space-y-2">
        {usedEntries.map((entry) => (
          <TraceCard key={entry.questionId} entry={entry} openaiOutcome={openaiOutcome} openaiConfigured={openaiConfigured} />
        ))}
      </ul>

      {unusedEntries.length > 0 && (
        <details className="group rounded-xl border border-border/60 bg-surface/40">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted">
            {unusedEntries.length} speculative question{unusedEntries.length === 1 ? "" : "s"} fetched but unused this
            turn <span className="text-muted/70">(click to expand)</span>
          </summary>
          <ul className="space-y-2 p-2 pt-0">
            {unusedEntries.map((entry) => (
              <TraceCard key={entry.questionId} entry={entry} openaiOutcome={openaiOutcome} openaiConfigured={openaiConfigured} dimmed />
            ))}
          </ul>
        </details>
      )}

      {lastReply && (
        <EvaluationPanel
          task="Chat reply quality"
          criteria={REPLY_CRITERIA}
          input={lastMessage ?? ""}
          context={documentText ?? undefined}
          typesafeOutput={lastReply}
          openaiOutput={null}
          openaiConfigured={openaiConfigured}
        />
      )}

      {sessionTotals.turns > 0 && (
        <div className="rounded-xl border border-border bg-surface p-3 text-sm">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
            Session: {sessionTotals.turns} turn{sessionTotals.turns === 1 ? "" : "s"}
          </p>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="shrink-0 text-muted">TypeSafe cost</span>
              <span className="shrink-0 font-bold tabular-nums text-foreground">{fmtUsd(sessionTotals.typesafe.costUsd)}</span>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="shrink-0 text-muted">OpenAI cost</span>
              <span className="shrink-0 font-bold tabular-nums text-foreground">
                {sessionTotals.openai.calls > 0 ? fmtUsd(sessionTotals.openai.costUsd) : "not run"}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TraceCard({
  entry,
  openaiOutcome,
  openaiConfigured,
  dimmed = false,
}: {
  entry: TraceEntry;
  openaiOutcome: OpenAIRunOutcome | null;
  openaiConfigured: boolean;
  dimmed?: boolean;
}) {
  const oaAnswer = openaiAnswerFor(openaiOutcome, entry.questionId);
  const ts = typesafeSummary(entry.answer);
  const match = oaAnswer ? agrees(entry.answer, oaAnswer.value) : null;
  return (
    <li
      className={`animate-in rounded-xl border p-3 transition-opacity ${
        dimmed ? "border-border/60 bg-surface/30 opacity-70" : "border-border bg-surface"
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-md bg-elevated px-1.5 py-0.5 text-xs font-medium text-secondary">
            {SKILL_LABELS[entry.skill] ?? entry.skill}
          </span>
          <code className="truncate text-sm text-muted">{entry.questionId}</code>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">TypeSafe</p>
          <AnswerView answer={entry.answer} />
        </div>
        <div className="border-t border-border/60 pt-2 lg:border-t-0 lg:border-l lg:pl-3 lg:pt-0">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">OpenAI</p>
            {match != null && (
              <span className={`text-xs font-bold ${match ? "text-emerald-700" : "text-rose-700"}`}>
                {match ? "✓ agrees" : "✕ disagrees"}
              </span>
            )}
          </div>
          {oaAnswer ? (
            <div className="text-sm">
              <span className="font-bold text-foreground">{String(oaAnswer.value)}</span>
              {oaAnswer.selfReportedConfidence != null && (
                <span className="ml-1.5 text-xs font-semibold text-muted">
                  self-reported {Math.round(oaAnswer.selfReportedConfidence * 100)}%
                </span>
              )}
              <p className="mt-0.5 text-xs text-muted">TypeSafe read: {ts.label}</p>
            </div>
          ) : (
            <p className="text-sm text-muted">{openaiConfigured ? "no answer for this question" : "not run"}</p>
          )}
        </div>
      </div>
    </li>
  );
}

function AnswerView({ answer }: { answer: TraceEntry["answer"] }) {
  if (answer.type === "noul") {
    return (
      <ProbabilityBar
        label="probability: yes"
        value={answer.noul}
        tone={answer.noul >= 0.6 ? "rose" : answer.noul <= 0.4 ? "emerald" : "amber"}
        highlight
      />
    );
  }
  if (answer.type === "choice") {
    const sorted = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
    return (
      <div className="space-y-1">
        {sorted.map(([option, prob]) => (
          <ProbabilityBar key={option} label={option} value={prob} tone="accent" highlight={option === answer.choice} />
        ))}
        <div className="pt-1 text-xs text-muted">confidence {Math.round(answer.confidence * 100)}%</div>
      </div>
    );
  }
  // score
  const sorted = Object.entries(answer.probabilities).sort((a, b) => Number(a[0]) - Number(b[0]));
  return (
    <div className="space-y-1">
      {sorted.map(([level, prob]) => (
        <ProbabilityBar key={level} label={`level ${level}`} value={prob} tone="amber" />
      ))}
      <div className="pt-1 text-xs text-muted">
        score {answer.score.toFixed(2)} · confidence {Math.round(answer.confidence * 100)}%
      </div>
    </div>
  );
}
