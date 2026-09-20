import type { ComplianceFlag } from "@/lib/orchestrator/run";
import type { OpenAIRunOutcome } from "@/lib/openai/types";
import { openaiAnswerFor } from "@/lib/compare/agreement";
import { OpenAINote } from "./OpenAINote";
import { RerunButton } from "./RerunButton";
import { EvalSummaryBar, type SummaryStat } from "./EvalSummaryBar";
import { ComparisonTable } from "./ComparisonTable";
import { complianceGroups } from "@/lib/compare/rows";
import { EvaluationPanel } from "./EvaluationPanel";
import { noOpenAIAnswerReason } from "@/lib/openai/unavailable";
import { buildCompliancePacket, type ComplianceDecision } from "@/lib/eval/packets";

/** Backend-neutral decisions for the evaluation packet. TypeSafe's come straight from the flags; OpenAI's from its boolean answers. */
function typesafeDecisions(flags: ComplianceFlag[]): ComplianceDecision[] {
  return flags.map((f) => ({ id: f.id, flagged: f.flagged }));
}

function openaiDecisions(flags: ComplianceFlag[], openaiOutcome: OpenAIRunOutcome | null): ComplianceDecision[] {
  const out: ComplianceDecision[] = [];
  for (const f of flags) {
    const oa = openaiAnswerFor(openaiOutcome, f.id);
    if (oa) out.push({ id: f.id, flagged: Boolean(oa.value) });
  }
  return out;
}

/** Excerpt-scoped compliance flags, shown above the whole-document list while a passage is highlighted. */
function ExcerptComplianceSection({
  selectedExcerpt,
  excerptStatus,
  excerptFlags,
  excerptOpenaiOutcome,
  openaiConfigured,
  typesafeSource,
}: {
  typesafeSource: "live" | "mock" | null;
  selectedExcerpt: string;
  excerptStatus: "idle" | "pending" | "done" | "error";
  excerptFlags: ComplianceFlag[];
  excerptOpenaiOutcome: OpenAIRunOutcome | null;
  openaiConfigured: boolean;
}) {
  const preview = selectedExcerpt.length > 160 ? `${selectedExcerpt.slice(0, 160)}…` : selectedExcerpt;
  return (
    <div className="animate-in space-y-2 rounded-xl border-2 border-accent bg-accent-soft p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-accent-soft-ink">Selected excerpt</p>
      <p className="border-l-2 border-accent-soft-ink/40 pl-2 text-sm italic text-secondary">&ldquo;{preview}&rdquo;</p>
      {excerptStatus === "pending" ? (
        <p className="text-sm font-semibold text-muted">Checking…</p>
      ) : excerptStatus === "error" ? (
        <p className="text-sm font-semibold text-rose-800">Couldn&rsquo;t check this excerpt.</p>
      ) : excerptFlags.length === 0 ? (
        <p className="text-sm text-muted">No answer yet.</p>
      ) : (
        <ComparisonTable groups={complianceGroups(excerptFlags, excerptOpenaiOutcome, openaiConfigured)} label="Excerpt compliance checks" firstColumn="Check" />
      )}
      <OpenAINote outcome={excerptOpenaiOutcome} />
      {excerptStatus === "done" && excerptFlags.length > 0 && (
        <EvaluationPanel
          kind="compliance"
          scope="compliance:excerpt"
          typesafePacket={buildCompliancePacket({ scope: "excerpt", decisions: typesafeDecisions(excerptFlags), sourceText: selectedExcerpt })}
          typesafeSource={typesafeSource}
          openaiPacket={buildCompliancePacket({ scope: "excerpt", decisions: openaiDecisions(excerptFlags, excerptOpenaiOutcome), sourceText: selectedExcerpt })}
          openaiConfigured={openaiConfigured}
          openaiEmptyReason={openaiDecisions(excerptFlags, excerptOpenaiOutcome).length > 0 ? undefined : noOpenAIAnswerReason(excerptOpenaiOutcome, "the compliance checks")}
        />
      )}
    </div>
  );
}

export function ComplianceFlags({
  flags,
  hasDocument,
  documentText,
  openaiOutcome,
  openaiConfigured,
  selectedExcerpt,
  excerptStatus,
  excerptFlags,
  excerptOpenaiOutcome,
  typesafeSource,
  excerptTypesafeSource,
  onRerun,
  rerunPending,
}: {
  /** Whether the whole-document TypeSafe answer came from the live model or the local demo heuristic. */
  typesafeSource: "live" | "mock" | null;
  /** Same, for the highlighted-excerpt answer. */
  excerptTypesafeSource: "live" | "mock" | null;
  flags: ComplianceFlag[];
  hasDocument: boolean;
  /** Full document text, the source text the judge grades the flags against. */
  documentText?: string | null;
  openaiOutcome: OpenAIRunOutcome | null;
  openaiConfigured: boolean;
  selectedExcerpt?: string | null;
  excerptStatus?: "idle" | "pending" | "done" | "error";
  excerptFlags?: ComplianceFlag[];
  excerptOpenaiOutcome?: OpenAIRunOutcome | null;
  /** Re-scans the highlighted excerpt, or re-checks the whole document when nothing is highlighted. */
  onRerun?: () => void;
  rerunPending?: boolean;
}) {
  const rerunLabel = selectedExcerpt ? "Re-scan excerpt" : "Re-check";
  const excerptSection = selectedExcerpt ? (
    <ExcerptComplianceSection
      selectedExcerpt={selectedExcerpt}
      excerptStatus={excerptStatus ?? "idle"}
      excerptFlags={excerptFlags ?? []}
      excerptOpenaiOutcome={excerptOpenaiOutcome ?? null}
      openaiConfigured={openaiConfigured}
      typesafeSource={excerptTypesafeSource}
    />
  ) : null;

  if (!hasDocument) {
    return (
      <p className="text-base text-secondary">
        Load a sample contract, then ask to &ldquo;check compliance&rdquo; to run the four standard flags.
      </p>
    );
  }
  if (flags.length === 0) {
    return (
      <div className="space-y-3">
        {excerptSection}
        <div className="flex items-center justify-between gap-3">
          <p className="text-base text-secondary">Ask the assistant to analyze or check compliance on the loaded contract.</p>
          {onRerun && <RerunButton onClick={onRerun} pending={Boolean(rerunPending)} label="Check now" />}
        </div>
      </div>
    );
  }
  const flaggedCount = flags.filter((f) => f.flagged).length;
  let agreeCount = 0;
  let comparedCount = 0;
  for (const f of flags) {
    const oa = openaiAnswerFor(openaiOutcome, f.id);
    if (!oa) continue;
    comparedCount += 1;
    if (Boolean(oa.value) === f.flagged) agreeCount += 1;
  }
  const summaryStats: SummaryStat[] = [
    comparedCount > 0
      ? {
          label: "agree:",
          value: `${agreeCount}/${comparedCount}`,
          tone: agreeCount === comparedCount ? "emerald" : agreeCount === 0 ? "rose" : "amber",
        }
      : { label: "agree:", value: "n/a" },
  ];

  return (
    <div className="space-y-2">
      {excerptSection}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <EvalSummaryBar icon="shield" headline={`${flaggedCount}/${flags.length} flags tripped`} stats={summaryStats} />
        {onRerun && <RerunButton onClick={onRerun} pending={Boolean(rerunPending)} label={rerunLabel} />}
      </div>
      {!openaiConfigured && (
        <p className="text-xs text-muted">
          Set <code className="text-accent-soft-ink">OPENAI_API_KEY</code> to see OpenAI&rsquo;s answer beside each check.
        </p>
      )}
      <OpenAINote outcome={openaiOutcome} />
      <ComparisonTable groups={complianceGroups(flags, openaiOutcome, openaiConfigured)} label="Compliance checks" firstColumn="Check" />
      <EvaluationPanel
        kind="compliance"
        typesafePacket={buildCompliancePacket({ scope: "document", decisions: typesafeDecisions(flags), sourceText: documentText ?? null })}
        typesafeSource={typesafeSource}
        openaiPacket={buildCompliancePacket({ scope: "document", decisions: openaiDecisions(flags, openaiOutcome), sourceText: documentText ?? null })}
        openaiConfigured={openaiConfigured}
        openaiEmptyReason={openaiDecisions(flags, openaiOutcome).length > 0 ? undefined : noOpenAIAnswerReason(openaiOutcome, "the compliance checks")}
      />
    </div>
  );
}
