import type { CompositeRisk } from "@/lib/skills/clauseRisk";
import { RISK_BAND_LABELS, RISK_DIMENSIONS, riskBand } from "@/lib/skills/clauseRisk";
import type { OpenAIRunOutcome } from "@/lib/openai/types";
import { computeOpenAIRisk, openaiRatings, overallTone, riskGroups } from "@/lib/compare/rows";
import { OpenAINote } from "./OpenAINote";
import { RerunButton } from "./RerunButton";
import { EvalSummaryBar, type SummaryStat } from "./EvalSummaryBar";
import { ComparisonTable } from "./ComparisonTable";
import { EvaluationPanel } from "./EvaluationPanel";
import { noOpenAIAnswerReason } from "@/lib/openai/unavailable";
import { buildRiskPacket } from "@/lib/eval/packets";

/** Where OpenAI's figures cannot appear, in the same one line every tab uses. */
function OpenAIKeyNote({ configured }: { configured: boolean }) {
  if (configured) return null;
  return (
    <p className="text-xs text-muted">
      Set <code className="text-accent-soft-ink">OPENAI_API_KEY</code> to see OpenAI&rsquo;s figures beside TypeSafe&rsquo;s.
    </p>
  );
}

/** Excerpt-scoped risk score, shown above the whole-document breakdown while a passage is highlighted. */
function ExcerptRiskSection({
  selectedExcerpt,
  excerptStatus,
  excerptRisk,
  excerptOpenaiOutcome,
  openaiConfigured,
  typesafeSource,
}: {
  selectedExcerpt: string;
  excerptStatus: "idle" | "pending" | "done" | "error";
  excerptRisk: CompositeRisk | null;
  excerptOpenaiOutcome: OpenAIRunOutcome | null;
  openaiConfigured: boolean;
  typesafeSource: "live" | "mock" | null;
}) {
  const preview = selectedExcerpt.length > 160 ? `${selectedExcerpt.slice(0, 160)}…` : selectedExcerpt;
  const openaiRisk = computeOpenAIRisk(excerptOpenaiOutcome);

  return (
    <div className="animate-in space-y-2 rounded-xl border-2 border-accent bg-accent-soft p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-accent-soft-ink">Selected excerpt</p>
      <p className="border-l-2 border-accent-soft-ink/40 pl-2 text-sm italic text-secondary">&ldquo;{preview}&rdquo;</p>
      {excerptStatus === "pending" ? (
        <p className="text-sm font-semibold text-muted">Scoring…</p>
      ) : excerptStatus === "error" || !excerptRisk ? (
        <p className="text-sm font-semibold text-rose-800">{excerptStatus === "error" ? "Couldn’t score this excerpt." : "No score yet."}</p>
      ) : (
        <>
          <ComparisonTable groups={riskGroups(excerptRisk, openaiRisk, openaiConfigured)} label="Excerpt risk" firstColumn="Rating" />
          <OpenAIKeyNote configured={openaiConfigured} />
          <OpenAINote outcome={excerptOpenaiOutcome} />
        </>
      )}
      {excerptStatus === "done" && (
        <EvaluationPanel
          kind="risk"
          scope="risk:excerpt"
          typesafePacket={
            excerptRisk
              ? buildRiskPacket({
                  scope: "excerpt",
                  ratings: excerptRisk.perDimension.map((d) => ({ id: d.id, normalized: d.normalized })),
                  overall: excerptRisk.overall,
                  sourceText: selectedExcerpt,
                })
              : null
          }
          typesafeSource={typesafeSource}
          openaiPacket={
            openaiRisk
              ? buildRiskPacket({ scope: "excerpt", ratings: openaiRatings(openaiRisk), overall: openaiRisk.overall, sourceText: selectedExcerpt })
              : null
          }
          openaiConfigured={openaiConfigured}
          openaiEmptyReason={openaiRisk ? undefined : noOpenAIAnswerReason(excerptOpenaiOutcome, "the three risk ratings")}
        />
      )}
    </div>
  );
}

export function RiskDashboard({
  risk,
  hasDocument,
  documentText,
  openaiOutcome,
  openaiConfigured,
  selectedExcerpt,
  excerptStatus,
  excerptRisk,
  excerptOpenaiOutcome,
  typesafeSource,
  excerptTypesafeSource,
  onRerun,
  rerunPending,
}: {
  risk: CompositeRisk | null;
  hasDocument: boolean;
  /** Full document text, the source text the judge grades the ratings against. */
  documentText?: string | null;
  openaiOutcome: OpenAIRunOutcome | null;
  openaiConfigured: boolean;
  selectedExcerpt?: string | null;
  excerptStatus?: "idle" | "pending" | "done" | "error";
  excerptRisk?: CompositeRisk | null;
  excerptOpenaiOutcome?: OpenAIRunOutcome | null;
  /** Whether the whole-document TypeSafe answer came from the live model or the local demo heuristic. */
  typesafeSource: "live" | "mock" | null;
  /** Same, for the highlighted-excerpt answer. */
  excerptTypesafeSource: "live" | "mock" | null;
  /** Re-scans the highlighted excerpt, or re-analyzes the whole document when nothing is highlighted. */
  onRerun?: () => void;
  rerunPending?: boolean;
}) {
  const rerunLabel = selectedExcerpt ? "Re-scan excerpt" : "Re-analyze";
  const excerptSection = selectedExcerpt ? (
    <ExcerptRiskSection
      selectedExcerpt={selectedExcerpt}
      excerptStatus={excerptStatus ?? "idle"}
      excerptRisk={excerptRisk ?? null}
      excerptOpenaiOutcome={excerptOpenaiOutcome ?? null}
      openaiConfigured={openaiConfigured}
      typesafeSource={excerptTypesafeSource}
    />
  ) : null;

  if (!hasDocument) {
    return (
      <p className="text-base text-secondary">
        Load a sample contract, then ask to &ldquo;analyze this contract&rdquo; to see the composite risk score here.
      </p>
    );
  }
  if (!risk) {
    return (
      <div className="space-y-3">
        {excerptSection}
        <div className="flex items-center justify-between gap-3">
          <p className="text-base text-secondary">Ask the assistant to analyze the loaded contract to compute a risk score.</p>
          {onRerun && <RerunButton onClick={onRerun} pending={Boolean(rerunPending)} label="Analyze now" />}
        </div>
      </div>
    );
  }

  const tsTone = overallTone(risk.overall);
  const openaiRisk = computeOpenAIRisk(openaiOutcome);

  const summaryStats: SummaryStat[] = [{ label: "level:", value: RISK_BAND_LABELS[riskBand(risk.overall)], tone: tsTone }];
  if (openaiRisk) {
    const deltaPts = Math.round(Math.abs(risk.overall - openaiRisk.overall) * 100);
    summaryStats.push(
      tsTone === overallTone(openaiRisk.overall)
        ? { label: "agree:", value: `yes (Δ${deltaPts}pt)`, tone: "emerald" }
        : { label: "agree:", value: `no (Δ${deltaPts}pt)`, tone: "rose" },
    );
  }
  const weights = (Object.keys(RISK_DIMENSIONS) as (keyof typeof RISK_DIMENSIONS)[]).map((id) => `${RISK_DIMENSIONS[id].weight}×${RISK_DIMENSIONS[id].label.split(" ")[0].toLowerCase()}`).join(" + ");

  return (
    <div className="space-y-2">
      {excerptSection}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <EvalSummaryBar icon="scale" headline={`Composite risk: ${Math.round(risk.overall * 100)}%`} stats={summaryStats} />
        {onRerun && <RerunButton onClick={onRerun} pending={Boolean(rerunPending)} label={rerunLabel} />}
      </div>
      <OpenAIKeyNote configured={openaiConfigured} />
      <OpenAINote outcome={openaiOutcome} />

      <ComparisonTable groups={riskGroups(risk, openaiRisk, openaiConfigured)} label="Risk ratings" firstColumn="Rating" />
      <p className="text-xs text-muted">overall = {weights} (weights owned in code, not either model)</p>

      <EvaluationPanel
        kind="risk"
        typesafePacket={buildRiskPacket({
          scope: "document",
          ratings: risk.perDimension.map((d) => ({ id: d.id, normalized: d.normalized })),
          overall: risk.overall,
          sourceText: documentText ?? null,
        })}
        typesafeSource={typesafeSource}
        openaiPacket={
          openaiRisk
            ? buildRiskPacket({ scope: "document", ratings: openaiRatings(openaiRisk), overall: openaiRisk.overall, sourceText: documentText ?? null })
            : null
        }
        openaiConfigured={openaiConfigured}
        openaiEmptyReason={openaiRisk ? undefined : noOpenAIAnswerReason(openaiOutcome, "the three risk ratings")}
      />
    </div>
  );
}
