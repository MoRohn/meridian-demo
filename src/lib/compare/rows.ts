import type { ComplianceFlag } from "../orchestrator/run";
import type { OpenAIRunOutcome } from "../openai/types";
import type { Check, Extraction } from "../citations/extract";
import { emptySide, type CitationRun, type SideRun } from "../citations/store";
import { RISK_BAND_LABELS, RISK_DIMENSIONS, riskBand, type CompositeRisk, type RiskDimensionId } from "../skills/clauseRisk";
import { COMPLIANCE_CHECKS } from "../skills/complianceGuard";
import { openaiAnswerFor } from "./agreement";

/**
 * The one shape every results tab is drawn from. Trace, Risk, Compliance and Citations all show the same thing: a list of
 * items, TypeSafe's answer to each, OpenAI's answer to the identical item, and whether they agree. Each tab builds
 * `CompareGroup`s from its own data (this file), and one component (ComparisonTable) draws them, so the four tabs cannot
 * drift apart in layout. Everything here is a pure function of the data.
 */
export type Tone = "rose" | "amber" | "emerald";

/** One backend's answer to one item: a headline, one line of supporting figures, an optional bar, and a tooltip. */
export interface CellData {
  main: string;
  sub?: string;
  /** Colors the headline (a flagged check is rose, a clear one emerald). */
  tone?: Tone;
  bar?: { value: number; tone: Tone | "accent" } | null;
  detail?: string;
}

/** A cell is an answer, or, when there is none, the plain words saying why ("not run", "checking…"). */
export type Cell = CellData | string;

export interface CompareRow {
  id: string;
  /** A small label above the title: where the expectation comes from ("Playbook \u00a74.2", "Cross-reference"). */
  tag?: string;
  title: string;
  /** A line under the title: what the item is, or which id was sent to the model. */
  subtitle?: string;
  /** Draw the subtitle as an identifier (monospace). */
  mono?: boolean;
  /** The words from the document this row rests on, with where they are. */
  evidence?: { ref: string; quote: string };
  /** Figures and key wording pulled from that evidence, shown as small chips. */
  facts?: string[];
  ts: Cell;
  oa: Cell;
  /** Whether the two backends agree; null when there is nothing to compare. */
  match: boolean | null;
}

export interface CompareGroup {
  id: string;
  label: string;
  /** A short remark beside the label ("3 questions", "2 of 4 flagged"). */
  note?: string;
  rows: CompareRow[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const notRun = (configured: boolean) => (configured ? "no answer" : "not run");

// ---- risk -------------------------------------------------------------------------------------------------------------

export interface OpenAIRisk {
  overall: number;
  byDimension: Partial<Record<RiskDimensionId, { normalized: number; confidence: number | null }>>;
}

/** OpenAI's per-dimension level index, normalized the same way TypeSafe's is, plus the composite weighted overall. */
export function computeOpenAIRisk(outcome: OpenAIRunOutcome | null): OpenAIRisk | null {
  if (!outcome?.ok) return null;
  const byDimension: OpenAIRisk["byDimension"] = {};
  let overall = 0;
  let any = false;
  for (const id of Object.keys(RISK_DIMENSIONS) as RiskDimensionId[]) {
    const answer = openaiAnswerFor(outcome, id);
    if (!answer) continue;
    any = true;
    const normalized = Number(answer.value) / (RISK_DIMENSIONS[id].criteria.length - 1);
    byDimension[id] = { normalized, confidence: answer.selfReportedConfidence };
    overall += normalized * RISK_DIMENSIONS[id].weight;
  }
  return any ? { overall, byDimension } : null;
}

/** OpenAI's per-dimension results as the backend-neutral ratings the evaluation packet expects. */
export function openaiRatings(risk: OpenAIRisk): { id: RiskDimensionId; normalized: number }[] {
  return (Object.keys(RISK_DIMENSIONS) as RiskDimensionId[]).filter((id) => risk.byDimension[id]).map((id) => ({ id, normalized: risk.byDimension[id]!.normalized }));
}

/** The tone of the composite, from its band. */
export function overallTone(overall: number): Tone {
  const band = riskBand(overall);
  return band === "high" ? "rose" : band === "moderate" ? "amber" : "emerald";
}

/** Each DIMENSION is toned by its own value, not the composite's: a low-risk termination clause is not red because liability raised the total. */
export function dimensionTone(normalized: number): Tone {
  return normalized >= 0.66 ? "rose" : normalized >= 0.33 ? "amber" : "emerald";
}

/** A one-line reason for the headline number: which dimension drives it. */
export function drivingFactor(ratings: { id: RiskDimensionId; normalized: number }[]): string {
  const top = [...ratings].sort((a, b) => b.normalized - a.normalized)[0];
  if (!top || top.normalized < 0.33) return "No single dimension stands out; every clause scored low.";
  const dim = RISK_DIMENSIONS[top.id];
  return `Primarily driven by ${dim.label.toLowerCase()} (weight ${dim.weight}).`;
}

export function riskGroups(risk: CompositeRisk, openai: OpenAIRisk | null, openaiConfigured: boolean): CompareGroup[] {
  const tsTone = overallTone(risk.overall);
  const oaTone = openai ? overallTone(openai.overall) : null;
  const missing = notRun(openaiConfigured);

  const overall: CompareRow = {
    id: "overall",
    title: "Overall risk",
    subtitle: drivingFactor(risk.perDimension),
    ts: { main: pct(risk.overall), sub: RISK_BAND_LABELS[riskBand(risk.overall)], tone: tsTone, bar: { value: risk.overall, tone: tsTone } },
    oa: openai && oaTone ? { main: pct(openai.overall), sub: RISK_BAND_LABELS[riskBand(openai.overall)], tone: oaTone, bar: { value: openai.overall, tone: oaTone } } : missing,
    match: oaTone ? tsTone === oaTone : null,
  };

  const dimensions: CompareRow[] = risk.perDimension.map((d) => {
    const dim = RISK_DIMENSIONS[d.id];
    const oa = openai?.byDimension[d.id];
    const tone = dimensionTone(d.normalized);
    return {
      id: d.id,
      title: dim.label,
      subtitle: `${dim.summary} Weight ${dim.weight}.`,
      ts: { main: pct(d.normalized), sub: `confidence ${pct(d.confidence)}`, tone, bar: { value: d.normalized, tone }, detail: dim.criteria.join(" / ") },
      oa: oa
        ? { main: pct(oa.normalized), sub: oa.confidence != null ? `self-reported ${pct(oa.confidence)}` : undefined, tone: dimensionTone(oa.normalized), bar: { value: oa.normalized, tone: dimensionTone(oa.normalized) } }
        : missing,
      match: oa ? dimensionTone(oa.normalized) === tone : null,
    };
  });

  return [
    { id: "composite", label: "Composite", note: "weighted total", rows: [overall] },
    { id: "dimensions", label: "Dimensions", note: `${dimensions.length} ratings`, rows: dimensions },
  ];
}

// ---- compliance ---------------------------------------------------------------------------------------------------------

export function complianceGroups(flags: readonly ComplianceFlag[], outcome: OpenAIRunOutcome | null, openaiConfigured: boolean): CompareGroup[] {
  const rows: CompareRow[] = flags.map((f) => {
    const oa = openaiAnswerFor(outcome, f.id);
    const oaFlagged = oa ? Boolean(oa.value) : null;
    return {
      id: f.id,
      title: f.label,
      subtitle: COMPLIANCE_CHECKS[f.id].definition,
      ts: { main: f.flagged ? "Flagged" : "Clear", sub: `${pct(f.probability)} probability`, tone: f.flagged ? "rose" : "emerald", bar: { value: f.probability, tone: f.flagged ? "rose" : "emerald" } },
      oa:
        oa && oaFlagged != null
          ? { main: oaFlagged ? "Flagged" : "Clear", sub: oa.selfReportedConfidence != null ? `self-reported ${pct(oa.selfReportedConfidence)}` : "no confidence reported", tone: oaFlagged ? "rose" : "emerald" }
          : notRun(openaiConfigured),
      match: oaFlagged != null ? oaFlagged === f.flagged : null,
    };
  });
  const flagged = flags.filter((f) => f.flagged).length;
  return [{ id: "compliance", label: "Compliance checks", note: `${flagged} of ${flags.length} flagged`, rows }];
}

// ---- citations -----------------------------------------------------------------------------------------------------------

export type Verdict = "verified" | "contradicted" | "unsupported";
/** The one vocabulary every citation row uses: what a source does to a claim. */
export const VERDICT_LABEL: Record<Verdict, string> = { verified: "Supported", contradicted: "Contradicted", unsupported: "Not addressed" };
export const VERDICT_TONE: Record<Verdict, Tone> = { verified: "emerald", contradicted: "rose", unsupported: "amber" };

const RULE_LABEL: Record<Exclude<Check["resolution"], "model">, { main: string; tone?: Tone }> = {
  broken: { main: "Broken reference", tone: "rose" },
  external: { main: "Not checkable" },
  missing: { main: "Missing", tone: "amber" },
};

/** One backend's cell for a check a model judges: what it said, or the plain words for why it has not. */
function judgedCell(side: SideRun, check: Check, backend: "typesafe" | "openai", openaiConfigured: boolean): Cell {
  if (backend === "openai" && !openaiConfigured) return "not run";
  if (side.status === "idle" || side.status === "pending") return "checking\u2026";
  if (side.status === "skipped") return side.reason === "not_configured" ? "not run" : "no answer";
  if (side.status === "error") return "call failed";
  const j = side.judged[check.id];
  if (!j) return "no answer";
  const tone = VERDICT_TONE[j.verdict];
  return {
    main: VERDICT_LABEL[j.verdict],
    sub: j.confidence != null ? `${j.basis === "calibrated" ? "confidence" : "self-reported"} ${pct(j.confidence)}` : undefined,
    tone,
    bar: j.confidence != null ? { value: j.confidence, tone } : null,
    detail: j.probabilities ? Object.entries(j.probabilities).sort((a, b) => b[1] - a[1]).map(([r, p]) => `${r} ${pct(p)}`).join(", ") : undefined,
  };
}

/** Every check as one comparison row: what it is, the evidence in the text, and each backend's answer. */
export function citationRow(check: Check, run: CitationRun | undefined, openaiConfigured: boolean): CompareRow {
  const base = {
    id: check.id,
    tag: check.origin,
    title: check.title,
    subtitle: check.question ?? check.note ?? undefined,
    evidence: check.quote && check.where ? { ref: check.where, quote: check.quote } : undefined,
    facts: check.facts.length ? check.facts : undefined,
  };
  if (check.resolution !== "model") {
    const rule = RULE_LABEL[check.resolution];
    return { ...base, subtitle: check.kind === "reference" ? (check.note ?? undefined) : (check.claim), ts: { main: rule.main, sub: check.note ?? undefined, tone: rule.tone }, oa: "no model needed", match: null };
  }
  const ts = judgedCell(run?.typesafe ?? emptySide("pending"), check, "typesafe", true);
  const oa = judgedCell(run?.openai ?? emptySide(openaiConfigured ? "pending" : "skipped"), check, "openai", openaiConfigured);
  const tsJudged = run?.typesafe.judged[check.id];
  const oaJudged = run?.openai.judged[check.id];
  return { ...base, ts, oa, match: tsJudged && oaJudged ? tsJudged.verdict === oaJudged.verdict : null };
}

export function citationGroups(extraction: Extraction, run: CitationRun | undefined, openaiConfigured: boolean): CompareGroup[] {
  const rows = (kind: Check["kind"]) => extraction.checks.filter((c) => c.kind === kind).map((c) => citationRow(c, run, openaiConfigured));
  const refs = rows("reference");
  const terms = rows("term");
  return [
    ...(refs.length ? [{ id: "references", label: "Cited in the text", note: `${refs.length} found`, rows: refs }] : []),
    ...(terms.length ? [{ id: "terms", label: "Key terms", note: "checked against the playbook", rows: terms }] : []),
  ];
}

export interface CitationSummary {
  total: number;
  supported: number;
  contradicted: number;
  notAddressed: number;
  broken: number;
  missing: number;
  notCheckable: number;
  /** Model checks still waiting on TypeSafe. */
  pending: number;
  /** How many checks both backends answered, and on how many they agreed. */
  compared: number;
  agreed: number;
}

/** The counts behind the summary bar. TypeSafe's verdict is the app's own; OpenAI's is what it is compared against. */
export function summarizeCitations(extraction: Extraction, run: CitationRun | undefined): CitationSummary {
  const out: CitationSummary = { total: extraction.checks.length, supported: 0, contradicted: 0, notAddressed: 0, broken: 0, missing: 0, notCheckable: 0, pending: 0, compared: 0, agreed: 0 };
  for (const c of extraction.checks) {
    if (c.resolution === "broken") out.broken += 1;
    else if (c.resolution === "missing") out.missing += 1;
    else if (c.resolution === "external") out.notCheckable += 1;
    else {
      const ts = run?.typesafe.judged[c.id];
      const oa = run?.openai.judged[c.id];
      if (!ts) out.pending += 1;
      else if (ts.verdict === "verified") out.supported += 1;
      else if (ts.verdict === "contradicted") out.contradicted += 1;
      else out.notAddressed += 1;
      if (ts && oa) {
        out.compared += 1;
        if (ts.verdict === oa.verdict) out.agreed += 1;
      }
    }
  }
  return out;
}

/** Which check to have the judge score by default: the one that matters most, a contradiction first, then a silent source, then a supported claim. */
export function mostConsequential(extraction: Extraction, run: CitationRun | undefined): string | null {
  const order: Verdict[] = ["contradicted", "unsupported", "verified"];
  for (const verdict of order) {
    const hit = extraction.checks.find((c) => c.resolution === "model" && run?.typesafe.judged[c.id]?.verdict === verdict);
    if (hit) return hit.id;
  }
  return null;
}

export type CitationFilter = "all" | "attention" | "disagree";

/** Whether a check is a finding a reader should look at: a contradiction, a source that is silent, a broken reference, a missing term. */
export function needsAttention(check: Check, run: CitationRun | undefined): boolean {
  if (check.resolution === "broken" || check.resolution === "missing") return true;
  if (check.resolution !== "model") return false;
  const verdict = run?.typesafe.judged[check.id]?.verdict;
  return verdict === "contradicted" || verdict === "unsupported";
}

/** Whether both models answered a check and gave different verdicts. */
export function modelsDisagree(check: Check, run: CitationRun | undefined): boolean {
  const ts = run?.typesafe.judged[check.id];
  const oa = run?.openai.judged[check.id];
  return Boolean(ts && oa && ts.verdict !== oa.verdict);
}

/** The extraction narrowed to what a filter shows, with its group notes counting only what is shown. */
export function filterExtraction(extraction: Extraction, run: CitationRun | undefined, filter: CitationFilter): Extraction {
  if (filter === "all") return extraction;
  const keep = filter === "attention" ? needsAttention : modelsDisagree;
  return { ...extraction, checks: extraction.checks.filter((c) => keep(c, run)) };
}
