import type { TraceEntry } from "@/lib/orchestrator/run";
import type { OpenAIRunOutcome, OpenAITurn } from "@/lib/openai/types";
import { agrees, agreementSummary, openaiAnswerFor, typesafeSummary } from "@/lib/compare/agreement";
import { ProbabilityBar } from "./ProbabilityBar";
import { OpenAINote } from "./OpenAINote";
import { RerunButton } from "./RerunButton";
import { EvalSummaryBar } from "./EvalSummaryBar";
import { Icon } from "./Icon";
import { noOpenAIAnswerReason } from "@/lib/openai/unavailable";
import { questionLabel } from "@/lib/trace/labels";
import { EvaluationPanel } from "./EvaluationPanel";
import { ActivityTrace, PerformancePanel } from "./ModelPerformance";
import { buildReplyPacket } from "@/lib/eval/packets";
import type { ComplianceFlag } from "@/lib/orchestrator/run";
import type { CompositeRisk } from "@/lib/skills/clauseRisk";

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
  onRerun,
  rerunPending,
  lastMessage,
  lastReply,
  documentText,
  judgments,
  openaiTurn,
}: {
  trace: TraceEntry[];
  source: "live" | "mock";
  openaiOutcome: OpenAIRunOutcome | null;
  openaiConfigured: boolean;
  /** Re-sends the last chat message to refresh this trace. Omitted (no button shown) until at least one message has been sent. */
  onRerun?: () => void;
  rerunPending?: boolean;
  /** The user message and TypeSafe's composed reply behind the trace currently shown; OpenAI's counterpart arrives as `openaiTurn`. Both are evaluated by DeepEval below. */
  lastMessage?: string | null;
  lastReply?: string | null;
  documentText?: string | null;
  /** The risk and compliance judgments the reply was composed from, checked against the reply by the judge. */
  judgments?: { risk: CompositeRisk | null; flags: ComplianceFlag[] } | null;
  /** The reply composed from OpenAI's answers by the same pipeline; evaluated alongside TypeSafe's. */
  openaiTurn?: OpenAITurn | null;
}) {
  if (trace.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-base text-secondary">
          Send a message to see the Jev call: every applicable skill&rsquo;s questions, asked together in one
          request, with the answers your code actually used highlighted, and right next to each one, what OpenAI
          returns for the identical question.
        </p>
        <ActivityTrace />
        <PerformancePanel />
      </div>
    );
  }

  const usedEntries = trace.filter((e) => e.used);
  const unusedEntries = trace.filter((e) => !e.used);
  const { agreed, compared } = agreementSummary(trace, openaiOutcome);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <EvalSummaryBar
          icon="trace"
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
        <p className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent-soft-ink">
          Set <code className="text-accent-soft-ink">OPENAI_API_KEY</code> to see OpenAI&rsquo;s answer next to every
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
          kind="reply"
          typesafePacket={buildReplyPacket({
            message: lastMessage ?? "",
            reply: lastReply,
            risk: judgments?.risk
              ? { overall: judgments.risk.overall, ratings: judgments.risk.perDimension.map((d) => ({ id: d.id, normalized: d.normalized })) }
              : null,
            flags: judgments?.flags ?? [],
            sourceText: documentText ?? null,
          })}
          typesafeSource={source}
          openaiPacket={
            openaiTurn
              ? buildReplyPacket({
                  message: lastMessage ?? "",
                  reply: openaiTurn.reply,
                  risk: openaiTurn.risk
                    ? { overall: openaiTurn.risk.overall, ratings: openaiTurn.risk.perDimension.map((d) => ({ id: d.id, normalized: d.normalized })) }
                    : null,
                  flags: openaiTurn.complianceFlags.map((f) => ({ id: f.id, label: f.label, flagged: f.flagged })),
                  sourceText: documentText ?? null,
                })
              : null
          }
          openaiConfigured={openaiConfigured}
          // The reply is cleared when a turn starts while the previous outcome lingers, so only a failed call is a reason to show.
          openaiEmptyReason={openaiTurn || openaiOutcome?.ok !== false ? undefined : noOpenAIAnswerReason(openaiOutcome, "a usable set of answers")}
        />
      )}

      <PerformancePanel />
      <ActivityTrace />
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
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="shrink-0 rounded-md bg-elevated px-1.5 py-0.5 text-xs font-medium text-secondary">
            {SKILL_LABELS[entry.skill] ?? entry.skill}
          </span>
          <span className="min-w-0 text-sm font-bold text-foreground">{questionLabel(entry.questionId)}</span>
          <code className="break-all text-xs text-muted" title="The question id sent to the model">
            {entry.questionId}
          </code>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">TypeSafe</p>
          <AnswerView answer={entry.answer} />
        </div>
        <div className="border-t border-border/60 pt-2 @xl:border-t-0 @xl:border-l @xl:pl-3 @xl:pt-0">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">OpenAI</p>
            {match != null && (
              <span className={`text-xs font-bold ${match ? "text-emerald-800" : "text-rose-800"}`}>
                <span className="inline-flex items-center gap-1"><Icon name={match ? "check" : "x"} size={12} />{match ? "agrees" : "disagrees"}</span>
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
