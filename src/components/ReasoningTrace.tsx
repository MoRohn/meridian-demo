import type { TraceEntry } from "@/lib/orchestrator/run";
import type { OpenAIRunOutcome, OpenAITurn } from "@/lib/openai/types";
import { agreementSummary } from "@/lib/compare/agreement";
import { OpenAINote } from "./OpenAINote";
import { TraceTable } from "./TraceTable";
import { RerunButton } from "./RerunButton";
import { EvalSummaryBar } from "./EvalSummaryBar";
import { noOpenAIAnswerReason } from "@/lib/openai/unavailable";
import { EvaluationPanel } from "./EvaluationPanel";
import { ActivityTrace, PerformancePanel } from "./ModelPerformance";
import { buildReplyPacket } from "@/lib/eval/packets";
import type { ComplianceFlag } from "@/lib/orchestrator/run";
import type { CompositeRisk } from "@/lib/skills/clauseRisk";

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
  // Model performance and the activity trace lead the page: they answer "how did the models do, and what ran" before any
  // per-question detail. Each renders nothing until there is something to show.
  const overview = (
    <>
      <PerformancePanel />
      <ActivityTrace />
    </>
  );

  if (trace.length === 0) {
    return (
      <div className="space-y-3">
        {overview}
        <p className="text-sm text-secondary">
          Send a message to see the Jev call: every applicable skill&rsquo;s questions asked together in one request, with
          OpenAI&rsquo;s answer to the identical question beside each.
        </p>
      </div>
    );
  }

  const usedEntries = trace.filter((e) => e.used);
  const unusedEntries = trace.filter((e) => !e.used);
  const { agreed, compared } = agreementSummary(trace, openaiOutcome);

  return (
    <div className="space-y-3">
      {overview}

      <section aria-label="Jev call" className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
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

        {!openaiConfigured && (
          <p className="text-xs text-muted">
            Set <code className="text-accent-soft-ink">OPENAI_API_KEY</code> to see OpenAI&rsquo;s answer beside each question.
          </p>
        )}
        <OpenAINote outcome={openaiOutcome} />

        <TraceTable entries={usedEntries} openaiOutcome={openaiOutcome} openaiConfigured={openaiConfigured} label="Questions the reply used" />

        {unusedEntries.length > 0 && (
          <details className="group">
            <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg px-1 text-xs font-bold text-muted transition-colors hover:text-deep">
              <span className="transition-transform group-open:rotate-90" aria-hidden>&rsaquo;</span>
              {unusedEntries.length} speculative question{unusedEntries.length === 1 ? "" : "s"} fetched but not used this turn
            </summary>
            <TraceTable entries={unusedEntries} openaiOutcome={openaiOutcome} openaiConfigured={openaiConfigured} dimmed label="Speculative questions, not used" />
          </details>
        )}
      </section>

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
    </div>
  );
}
