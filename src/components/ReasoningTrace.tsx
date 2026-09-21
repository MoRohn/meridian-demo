import type { TraceEntry } from "@/lib/orchestrator/run";
import type { OpenAIRunOutcome, OpenAITurn } from "@/lib/openai/types";
import { agreementSummary } from "@/lib/compare/agreement";
import { OpenAINote } from "./OpenAINote";
import { TurnAnalysis } from "./TurnAnalysis";
import { RerunButton } from "./RerunButton";
import { EvalSummaryBar } from "./EvalSummaryBar";
import { noOpenAIAnswerReason } from "@/lib/openai/unavailable";
import { EvaluationPanel } from "./EvaluationPanel";
import { ActivityTrace, PerformancePanel } from "./ModelPerformance";
import { buildReplyPacket } from "@/lib/eval/packets";
import type { ComplianceFlag } from "@/lib/orchestrator/run";
import type { CompositeRisk } from "@/lib/skills/clauseRisk";
import type { TurnAnswer } from "@/lib/chat/answer";
import { coverageOf } from "@/lib/trace/analysis";

/** What the last chat turn decided, beyond the trace: the judgments its reply was composed from, whether a guardrail stopped it, and who wrote the reply. */
export interface TurnJudgments {
  risk: CompositeRisk | null;
  flags: ComplianceFlag[];
  blocked?: "privileged" | "injection" | null;
  answer?: TurnAnswer | null;
  /** Why the demo heuristic answered when a TypeSafe key was supplied. */
  fallbackReason?: string | null;
}

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
  hasDocument = false,
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
  judgments?: TurnJudgments | null;
  /** The reply composed from OpenAI's answers by the same pipeline; evaluated alongside TypeSafe's. */
  openaiTurn?: OpenAITurn | null;
  /** Whether a document is loaded, which decides whether an analysis route can run. */
  hasDocument?: boolean;
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
          Send a message to trace how each model reached its answers: the path they took through the app&rsquo;s rules, the
          probabilities behind the routing, how sure each model was, and where TypeSafe and OpenAI disagreed.
        </p>
      </div>
    );
  }

  const { agreed, compared } = agreementSummary(trace, openaiOutcome);
  const { used } = coverageOf(trace, openaiOutcome);

  return (
    <div className="space-y-3">
      {overview}

      <section aria-label="Turn analysis" className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <EvalSummaryBar
            icon="trace"
            headline="How each model reached its answers"
            stats={[
              { label: "questions:", value: `${trace.length} in one call` },
              { label: "used:", value: `${used}/${trace.length}` },
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
            Set <code className="text-accent-soft-ink">OPENAI_API_KEY</code> to trace OpenAI beside TypeSafe.
          </p>
        )}
        <OpenAINote outcome={openaiOutcome} />

        <TurnAnalysis
          trace={trace}
          turn={{ risk: judgments?.risk ?? null, flags: judgments?.flags ?? [], blocked: judgments?.blocked ?? null, answer: judgments?.answer ?? null, fallbackReason: judgments?.fallbackReason ?? null }}
          source={source}
          openaiOutcome={openaiOutcome}
          openaiTurn={openaiTurn ?? null}
          openaiConfigured={openaiConfigured}
          hasDocument={hasDocument}
        />
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
