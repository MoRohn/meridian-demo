import type { CompositeRisk, RiskDimensionId } from "@/lib/skills/clauseRisk";
import { RISK_DIMENSIONS } from "@/lib/skills/clauseRisk";
import type { OpenAIRunOutcome } from "@/lib/openai/types";
import { openaiAnswerFor } from "@/lib/compare/agreement";
import { ProbabilityBar, ConfidenceBadge } from "./ProbabilityBar";
import { OpenAINote } from "./OpenAINote";
import { RerunButton } from "./RerunButton";
import { EvalSummaryBar, type SummaryStat } from "./EvalSummaryBar";
import { EvaluationPanel } from "./EvaluationPanel";

const RISK_CRITERIA =
  "Given the contract text in context, assess whether the stated overall risk score and level are " +
  "well-justified: does the score plausibly reflect the actual liability, indemnification, and " +
  "termination terms in the text, and is the reasoning sound?";

function riskTone(overall: number) {
  const tone: "rose" | "amber" | "emerald" = overall >= 0.66 ? "rose" : overall >= 0.33 ? "amber" : "emerald";
  const label = overall >= 0.66 ? "High risk" : overall >= 0.33 ? "Moderate risk" : "Low risk";
  const text = tone === "rose" ? "text-rose-700" : tone === "amber" ? "text-amber-700" : "text-emerald-700";
  const ring = tone === "rose" ? "from-rose-500" : tone === "amber" ? "from-amber-500" : "from-emerald-500";
  return { tone, label, text, ring };
}

/** Each DIMENSION gets its own severity color based on its own normalized value, not the composite's — a low-risk termination clause shouldn't read as red just because liability dragged the overall score up. */
function dimensionTone(normalized: number): "rose" | "amber" | "emerald" {
  return normalized >= 0.66 ? "rose" : normalized >= 0.33 ? "amber" : "emerald";
}

/** OpenAI's per-dimension level index, normalized the same way TypeSafe's is, plus the composite weighted overall. */
function computeOpenAIRisk(outcome: OpenAIRunOutcome | null): { overall: number; byDimension: Partial<Record<RiskDimensionId, { normalized: number; confidence: number | null }>> } | null {
  if (!outcome?.ok) return null;
  const ids = Object.keys(RISK_DIMENSIONS) as RiskDimensionId[];
  const byDimension: Partial<Record<RiskDimensionId, { normalized: number; confidence: number | null }>> = {};
  let overall = 0;
  let any = false;
  for (const id of ids) {
    const answer = openaiAnswerFor(outcome, id);
    if (!answer) continue;
    any = true;
    const topLevel = RISK_DIMENSIONS[id].criteria.length - 1;
    const normalized = Number(answer.value) / topLevel;
    byDimension[id] = { normalized, confidence: answer.selfReportedConfidence };
    overall += normalized * RISK_DIMENSIONS[id].weight;
  }
  return any ? { overall, byDimension } : null;
}

/** A one-line summary of which dimension is driving the composite score, so the headline number always comes with a "why." */
function drivingFactor(risk: CompositeRisk): string {
  const top = [...risk.perDimension].sort((a, b) => b.normalized - a.normalized)[0];
  if (top.normalized < 0.33) return "No single dimension stands out; every clause scored low.";
  const dim = RISK_DIMENSIONS[top.id];
  const name = top.id
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace("Exposure", "exposure")
    .replace("Harshness", "harshness")
    .replace("Rigidity", "rigidity");
  return `Primarily driven by ${name.toLowerCase()} (weight ${dim.weight}).`;
}

/** Excerpt-scoped risk score, shown above the whole-document breakdown while a passage is highlighted. */
function ExcerptRiskSection({
  selectedExcerpt,
  excerptStatus,
  excerptRisk,
  excerptOpenaiOutcome,
  openaiConfigured,
}: {
  selectedExcerpt: string;
  excerptStatus: "idle" | "pending" | "done" | "error";
  excerptRisk: CompositeRisk | null;
  excerptOpenaiOutcome: OpenAIRunOutcome | null;
  openaiConfigured: boolean;
}) {
  const preview = selectedExcerpt.length > 160 ? `${selectedExcerpt.slice(0, 160)}…` : selectedExcerpt;
  const ts = excerptRisk ? riskTone(excerptRisk.overall) : null;
  const openaiRisk = computeOpenAIRisk(excerptOpenaiOutcome);
  const oa = openaiRisk ? riskTone(openaiRisk.overall) : null;

  return (
    <div className="animate-in space-y-2 rounded-xl border-2 border-accent bg-accent-soft p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-accent-ink">Selected excerpt</p>
      <p className="border-l-2 border-accent-ink/40 pl-2 text-sm italic text-secondary">&ldquo;{preview}&rdquo;</p>
      {excerptStatus === "pending" ? (
        <p className="text-sm font-semibold text-muted">Scoring…</p>
      ) : excerptStatus === "error" ? (
        <p className="text-sm font-semibold text-rose-700">Couldn&rsquo;t score this excerpt.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface p-3">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">TypeSafe</p>
            {ts ? (
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-extrabold tracking-tight text-foreground">{Math.round(excerptRisk!.overall * 100)}%</span>
                <span className={`text-sm font-bold ${ts.text}`}>{ts.label}</span>
              </div>
            ) : (
              <p className="text-sm text-muted">—</p>
            )}
          </div>
          <div className="rounded-lg border border-border bg-surface p-3">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">OpenAI</p>
            {oa ? (
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-extrabold tracking-tight text-foreground">{Math.round(openaiRisk!.overall * 100)}%</span>
                <span className={`text-sm font-bold ${oa.text}`}>{oa.label}</span>
              </div>
            ) : (
              <p className="text-sm text-muted">{openaiConfigured ? "not run" : "Set OPENAI_API_KEY to compute this."}</p>
            )}
            <OpenAINote outcome={excerptOpenaiOutcome} />
          </div>
        </div>
      )}
      {excerptStatus === "done" && (
        <EvaluationPanel
          task="Excerpt risk score"
          criteria={RISK_CRITERIA}
          input="Risk score for the highlighted excerpt"
          context={selectedExcerpt}
          typesafeOutput={ts ? `${Math.round(excerptRisk!.overall * 100)}% (${ts.label})` : null}
          openaiOutput={oa ? `${Math.round(openaiRisk!.overall * 100)}% (${oa.label})` : null}
          openaiConfigured={openaiConfigured}
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
  onRerun,
  rerunPending,
}: {
  risk: CompositeRisk | null;
  hasDocument: boolean;
  /** Full document text, passed as G-Eval's judging context — see EvaluationPanel. */
  documentText?: string | null;
  openaiOutcome: OpenAIRunOutcome | null;
  openaiConfigured: boolean;
  selectedExcerpt?: string | null;
  excerptStatus?: "idle" | "pending" | "done" | "error";
  excerptRisk?: CompositeRisk | null;
  excerptOpenaiOutcome?: OpenAIRunOutcome | null;
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
      <div className="space-y-4">
        {excerptSection}
        <div className="flex items-center justify-between gap-3">
          <p className="text-base text-secondary">Ask the assistant to analyze the loaded contract to compute a risk score.</p>
          {onRerun && <RerunButton onClick={onRerun} pending={Boolean(rerunPending)} label="Analyze now" />}
        </div>
      </div>
    );
  }

  const ts = riskTone(risk.overall);
  const openaiRisk = computeOpenAIRisk(openaiOutcome);
  const oa = openaiRisk ? riskTone(openaiRisk.overall) : null;

  const summaryStats: SummaryStat[] = [{ label: "level:", value: ts.label, tone: ts.tone }];
  if (oa) {
    const deltaPts = Math.round(Math.abs(risk.overall - openaiRisk!.overall) * 100);
    summaryStats.push(
      ts.tone === oa.tone
        ? { label: "agree:", value: `yes (Δ${deltaPts}pt)`, tone: "emerald" }
        : { label: "agree:", value: `no (Δ${deltaPts}pt)`, tone: "rose" }
    );
  }

  return (
    <div className="space-y-4">
      {excerptSection}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <EvalSummaryBar icon="⚖️" headline={`Composite risk: ${Math.round(risk.overall * 100)}%`} stats={summaryStats} />
        {onRerun && <RerunButton onClick={onRerun} pending={Boolean(rerunPending)} label={rerunLabel} />}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="animate-in overflow-hidden rounded-xl border border-border bg-surface p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">TypeSafe</p>
          <div className={`h-1 w-full bg-gradient-to-r ${ts.ring} to-transparent`} />
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-5xl font-extrabold tracking-tight text-foreground">{Math.round(risk.overall * 100)}%</span>
            <span className={`text-sm font-bold ${ts.text}`}>{ts.label}</span>
          </div>
          <p className="mt-2 text-xs font-medium text-muted">{drivingFactor(risk)}</p>
        </div>

        <div className="animate-in overflow-hidden rounded-xl border border-border bg-surface p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">OpenAI</p>
          {oa ? (
            <>
              <div className={`h-1 w-full bg-gradient-to-r ${oa.ring} to-transparent`} />
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-5xl font-extrabold tracking-tight text-foreground">{Math.round(openaiRisk!.overall * 100)}%</span>
                <span className={`text-sm font-bold ${oa.text}`}>{oa.label}</span>
              </div>
            </>
          ) : (
            <p className="pt-2 text-sm text-muted">
              {openaiConfigured ? "not run for this turn" : "Set OPENAI_API_KEY to compute this alongside TypeSafe."}
            </p>
          )}
          <OpenAINote outcome={openaiOutcome} />
        </div>
      </div>

      <p className="text-sm text-muted">
        overall = 0.5×liability + 0.3×indemnification + 0.2×termination (weights owned in code, not either model)
      </p>

      <ul className="space-y-3">
        {risk.perDimension.map((d) => {
          const dim = RISK_DIMENSIONS[d.id];
          const oaDim = openaiRisk?.byDimension[d.id];
          return (
            <li key={d.id} className="animate-in space-y-2 rounded-xl border border-border bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-secondary">{dim.instructions}</span>
                <span className="shrink-0 text-xs text-muted">weight {dim.weight}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">TypeSafe</p>
                  <ProbabilityBar label="normalized" value={d.normalized} tone={dimensionTone(d.normalized)} highlight />
                  <div className="mt-1">
                    <ConfidenceBadge confidence={d.confidence} />
                  </div>
                </div>
                <div className="border-t border-border/60 pt-2 lg:border-t-0 lg:border-l lg:pl-3 lg:pt-0">
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">OpenAI</p>
                  {oaDim ? (
                    <>
                      <ProbabilityBar label="normalized" value={oaDim.normalized} tone={dimensionTone(oaDim.normalized)} highlight />
                      {oaDim.confidence != null && (
                        <p className="mt-1 text-xs font-semibold text-muted">self-reported {Math.round(oaDim.confidence * 100)}%</p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted">{openaiConfigured ? "no answer" : "not run"}</p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <EvaluationPanel
        task="Composite risk score"
        criteria={RISK_CRITERIA}
        input="Overall contract risk score"
        context={documentText ?? undefined}
        typesafeOutput={`${Math.round(risk.overall * 100)}% (${ts.label}). ${drivingFactor(risk)}`}
        openaiOutput={oa ? `${Math.round(openaiRisk!.overall * 100)}% (${oa.label})` : null}
        openaiConfigured={openaiConfigured}
      />
    </div>
  );
}
