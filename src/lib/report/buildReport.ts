import { formatElapsed, type ActivityRecord } from "../activity/log";
import { BACKENDS, BACKEND_NAMES, bandFor, describeMatchup, matchups, type Backend } from "../compare/performance";
import { fmtUsd } from "../compare/pricing";
import { describeIntegrity } from "../eval/integrity";
import { EVAL_KIND_IDS } from "../eval/kinds";
import type { StoredEvaluationRow } from "../eval/store";
import type { EvalKind, EvalResult } from "../eval/types";
import type { TraceEntry } from "../orchestrator/run";
import { questionLabel } from "../trace/labels";
import type { Block, ReportDoc, ReportFormat } from "./doc";

/**
 * The downloadable report. Everything in it is read from what Meridian already holds for the session: the judge's
 * evaluations (score, verdict, rubric), the activity log (every model call, in order) and the latest reasoning trace.
 * Nothing is recomputed or invented here; a figure with no data behind it is written "n/a", never as zero.
 *
 * The result is a format-neutral document (see doc.ts): the data table at the very top (one row per activity and model,
 * cells clipped so it stays readable), then scoring with the judge's explanation for Risk, Compliance and Citations,
 * then the trace. Renderers turn it into HTML, PDF, Word or Markdown.
 */
export interface ReportInput {
  generatedAt: number;
  document: { name: string; contractType: string | null } | null;
  evals: readonly StoredEvaluationRow[];
  activities: readonly ActivityRecord[];
  trace: readonly TraceEntry[];
}

export interface ReportTable {
  columns: string[];
  rows: string[][];
}

const NA = "n/a";
const CELL_MAX = 40;
const REASON_MAX = 90;

export const ACTIVITY_NAMES: Record<EvalKind, string> = {
  risk: "Risk score",
  compliance: "Compliance flags",
  citation: "Citation verdict",
  reply: "Assistant reply",
};

/** Section order in the report: the three the reader asked about first, the chat reply after. */
const KIND_ORDER: EvalKind[] = ["risk", "compliance", "citation", "reply"];
const isKind = (s: string): s is EvalKind => (EVAL_KIND_IDS as string[]).includes(s);

/** One line for a table cell: whitespace collapsed and clipped with an ellipsis. Escaping is the renderer's job. */
export function cell(value: string | number | null | undefined, max = CELL_MAX): string {
  if (value == null || value === "") return NA;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return NA;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const utcTime = (ms: number) => new Date(ms).toISOString().slice(11, 19);
const utcStamp = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

interface Surface {
  scope: string;
  kind: EvalKind | null;
  excerpt: boolean;
  /** What was judged, for the Scope column: the whole contract, a highlighted passage, or one checked section. */
  area: string;
}

function surfaceOf(scope: string, kind: EvalKind | undefined): Surface {
  const [base, suffix] = scope.split(":");
  const resolved = kind ?? (isKind(base) ? base : null);
  const excerpt = suffix === "excerpt";
  const area = excerpt ? "Excerpt" : resolved === "citation" ? "Cited section" : resolved === "reply" ? "Latest reply" : "Whole document";
  return { scope, kind: resolved, excerpt, area };
}

/** Every evaluated surface in reading order: kind first, whole document before excerpt. */
function surfaces(evals: readonly StoredEvaluationRow[]): Surface[] {
  const seen = new Map<string, Surface>();
  for (const e of evals) if (!seen.has(e.scope)) seen.set(e.scope, surfaceOf(e.scope, e.kind));
  const rank = (s: Surface) => (s.kind ? KIND_ORDER.indexOf(s.kind) : KIND_ORDER.length);
  return [...seen.values()].sort((a, b) => rank(a) - rank(b) || Number(a.excerpt) - Number(b.excerpt) || a.scope.localeCompare(b.scope));
}

const activityName = (s: Surface) => (s.kind ? ACTIVITY_NAMES[s.kind] : s.scope);

type Cell = { row: StoredEvaluationRow | undefined; result: EvalResult | null; status: string };

function cellFor(evals: readonly StoredEvaluationRow[], scope: string, backend: Backend): Cell {
  const row = evals.find((e) => e.scope === scope && e.backend === backend);
  if (!row) return { row, result: null, status: "Not evaluated" };
  if (row.pending) return { row, result: null, status: "Pending" };
  if (!row.outcome) return { row, result: null, status: "Not evaluated" };
  if (row.outcome.ok) return { row, result: row.outcome.result, status: "Scored" };
  return { row, result: null, status: row.outcome.reason === "not_configured" ? "Judge not configured" : `Failed${row.outcome.code ? ` (${row.outcome.code})` : ""}` };
}

// ---- 1. the data table ---------------------------------------------------

const COLUMNS = [
  "Activity",
  "Scope",
  "Model",
  "Status",
  "Score",
  "Result",
  "Pass at",
  "Band (0-10)",
  "Rubric",
  "Judge model",
  "Judge time",
  "Judge cost",
  "Integrity",
  "Judge's explanation",
];

/** One row per evaluated activity and model, straight from the stored evaluations. A model with no evaluation still gets its row. */
export function buildReportTable(evals: readonly StoredEvaluationRow[]): ReportTable {
  const rows: string[][] = [];
  for (const s of surfaces(evals)) {
    for (const backend of BACKENDS) {
      const { result, status } = cellFor(evals, s.scope, backend);
      const band = result ? bandFor(result) : null;
      rows.push([
        activityName(s),
        s.area,
        BACKEND_NAMES[backend],
        status,
        result ? pct(result.score) : NA,
        result ? (result.success ? "Pass" : "Fail") : NA,
        result ? pct(result.threshold) : NA,
        band ? `${band.low}-${band.high}` : NA,
        result ? `${result.rubric.id} v${result.rubric.version}` : NA,
        result?.judgeModel ?? NA,
        result ? formatElapsed(result.latencyMs) : NA,
        result?.judgeCostUsd != null ? fmtUsd(result.judgeCostUsd) : NA,
        result ? (result.integrity.status === "suspicious" ? "Suspicious" : "Clean") : NA,
        result ? result.reason : NA,
      ].map((v, i) => cell(v, i === COLUMNS.length - 1 ? REASON_MAX : CELL_MAX)));
    }
  }
  return { columns: COLUMNS, rows };
}

// ---- 2-4. scoring with explanation ---------------------------------------

const SECTION_TITLES = { risk: "Risk", compliance: "Compliance", citation: "Citations" } as const;

const para = (text: string, lead?: string, tone?: "muted" | "warn"): Block => ({ type: "paragraph", text, lead, tone });
const heading = (level: 1 | 2 | 3 | 4, text: string): Block => ({ type: "heading", level, text });

function surfaceSection(s: Surface, evals: readonly StoredEvaluationRow[], title: string): Block[] {
  const out: Block[] = [heading(3, title)];
  const cells = BACKENDS.map((b) => ({ backend: b, ...cellFor(evals, s.scope, b) }));
  const first = cells.find((c) => c.result)?.result;

  if (first) {
    out.push(para(`Rubric ${first.rubric.id} v${first.rubric.version} (${first.rubric.title}), judged by ${first.judgeModel}. A score passes at ${pct(first.threshold)}.`, "How it is scored."));
    if (first.steps.length) out.push(para("The judge followed these steps:"), { type: "list", ordered: true, items: first.steps });
    if (first.bands.length) out.push(para("Score bands (0-10):"), { type: "list", ordered: false, items: first.bands.map((b) => `${b.low}-${b.high}: ${b.outcome}`) });
  }

  for (const c of cells) {
    out.push(heading(4, BACKEND_NAMES[c.backend]));
    if (!c.result) {
      out.push(para(`Not scored: ${c.status.toLowerCase()}.`, undefined, "muted"));
      continue;
    }
    const r = c.result;
    const band = bandFor(r);
    out.push(para(`Judge time ${formatElapsed(r.latencyMs)}, judge cost ${r.judgeCostUsd != null ? fmtUsd(r.judgeCostUsd) : NA}.`, `Score: ${pct(r.score)} (${Math.round(r.score * 10)}/10), ${r.success ? "Pass" : "Fail"}.`));
    out.push(para("", "Explanation."), { type: "quote", text: r.reason.trim() });
    if (band) out.push(para(`Band ${band.low}-${band.high}: ${band.outcome}`, `What ${band.points}/10 means.`));
    const integrity = describeIntegrity(r);
    if (integrity) out.push(para(integrity, "Warning.", "warn"));
    const packet = c.row?.packet;
    if (packet) {
      out.push(para("", "What was asked."), { type: "code", text: packet.input.trim() });
      out.push(para("", `What ${BACKEND_NAMES[c.backend]} answered (as the judge saw it).`), { type: "code", text: packet.actualOutput.trim() });
      if (packet.context) out.push(para("", "Source text it was checked against."), { type: "code", text: packet.context.trim() });
      else out.push(para(`Judged against ${packet.contextChars.toLocaleString("en-US")} characters of source text (the full document, not repeated here).`, undefined, "muted"));
    }
  }

  const both = matchups(evals).find((m) => m.scope === s.scope);
  if (both) out.push(para(describeMatchup(both), "Head to head."));
  return out;
}

/** Scoring sections for Risk, Compliance and Citations (and the assistant reply when it was judged). Returns the next section number. */
function scoringSections(evals: readonly StoredEvaluationRow[]): { blocks: Block[]; next: number } {
  const out: Block[] = [];
  const all = surfaces(evals);
  let n = 2;
  for (const kind of ["risk", "compliance", "citation"] as const) {
    out.push(heading(2, `${n++}. ${SECTION_TITLES[kind]}: scoring and explanation`));
    const mine = all.filter((s) => s.kind === kind);
    if (mine.length === 0) {
      out.push(para(`No ${kind} evaluation has run in this session.`, undefined, "muted"));
      continue;
    }
    for (const s of mine) out.push(...surfaceSection(s, evals, mine.length > 1 || s.excerpt ? s.area : ACTIVITY_NAMES[kind]));
  }
  const replies = all.filter((s) => s.kind === "reply");
  if (replies.length) {
    out.push(heading(2, `${n++}. Assistant reply: scoring and explanation`));
    for (const s of replies) out.push(...surfaceSection(s, evals, ACTIVITY_NAMES.reply));
  }
  return { blocks: out, next: n };
}

// ---- trace ----------------------------------------------------------------

const ACTOR_NAMES = { typesafe: "TypeSafe", openai: "OpenAI", judge: "Judge" } as const;

function activityTrace(activities: readonly ActivityRecord[]): Block[] {
  if (activities.length === 0) return [para("No model calls have been made in this session.", undefined, "muted")];
  const rows = activities.map((a, i) => {
    const duration = a.status === "pending" ? "running" : formatElapsed(a.modelMs ?? Math.max(0, (a.endedAt ?? a.startedAt) - a.startedAt));
    const status = a.status === "error" ? "Failed" : a.status === "pending" ? "Running" : a.simulated ? "Simulated" : "Done";
    const tokens = a.inputTokens != null || a.outputTokens != null ? `${a.inputTokens ?? 0} / ${a.outputTokens ?? 0}` : NA;
    return [
      String(i + 1),
      utcTime(a.startedAt),
      ACTOR_NAMES[a.actor],
      a.label,
      status,
      duration,
      a.model,
      tokens,
      a.costUsd != null ? fmtUsd(a.costUsd) : NA,
      a.score != null ? pct(a.score) : NA,
      a.note,
    ].map((v) => cell(v, 48));
  });
  return [{ type: "table", columns: ["#", "Started (UTC)", "Model", "Action", "Status", "Duration", "Model ID", "Tokens in / out", "Cost", "Judge score", "Note"], rows }];
}

function answerSummary(entry: TraceEntry): string {
  const a = entry.answer;
  if (a.type === "choice") return `${a.choice} (confidence ${pct(a.confidence)})`;
  if (a.type === "score") {
    const top = Math.max(...Object.keys(a.legend).map(Number).filter(Number.isFinite));
    return `${a.score}${Number.isFinite(top) ? ` of ${top}` : ""} (confidence ${pct(a.confidence)})`;
  }
  return `${pct(a.noul)} probability true`;
}

function reasoningTrace(trace: readonly TraceEntry[]): Block[] {
  if (trace.length === 0) return [para("No chat turn has run yet, so there is no reasoning trace.", undefined, "muted")];
  const rows = trace.map((t, i) => [String(i + 1), t.skill, questionLabel(t.questionId), answerSummary(t), t.used ? "Yes" : "No"].map((v) => cell(v, 56)));
  return [{ type: "table", columns: ["#", "Skill", "Question", "TypeSafe's answer", "Used in reply"], rows }];
}

// ---- the report -------------------------------------------------------------

/** The latest model id each actor reported, for the report's header. A real model is preferred; the local demo heuristic is named as such. */
function modelsUsed(activities: readonly ActivityRecord[]): string {
  return (["typesafe", "openai", "judge"] as const)
    .map((actor) => {
      const mine = [...activities].reverse().filter((a) => a.actor === actor && a.model);
      const last = mine.find((a) => !a.simulated) ?? mine[0];
      return `${ACTOR_NAMES[actor]}: ${last ? `${last.model}${last.simulated ? " (simulated, not evaluated)" : ""}` : NA}`;
    })
    .join(" · ");
}

export function buildReportDoc(input: ReportInput): ReportDoc {
  const { generatedAt, document, evals, activities, trace } = input;
  const table = buildReportTable(evals);
  const title = "Meridian evaluation report";
  const blocks: Block[] = [
    heading(1, title),
    para(utcStamp(generatedAt), "Generated:"),
    para(document ? `${document.name}${document.contractType ? ` (${document.contractType})` : ""}` : "none loaded", "Document:"),
    para(modelsUsed(activities), "Models:"),
    heading(2, "1. Evaluation data"),
    para("One row per activity and model, taken directly from the independent judge's evaluations in this session. Long text is clipped here; the full explanation for each row is in the sections below."),
  ];

  if (table.rows.length === 0) {
    blocks.push(para("No evaluations have run yet. Analyze a contract, then open a tab to score it.", undefined, "muted"));
  } else {
    blocks.push({ type: "table", columns: table.columns, rows: table.rows });
    blocks.push(para("Score is the judge's 0-100% rating of the answer against the source text. Pass at is the threshold for that rubric. Band is the 0-10 score band the score falls in (what that band means is spelled out below). Scores are comparable only within one rubric version.", undefined, "muted"));
  }

  const scoring = scoringSections(evals);
  blocks.push(...scoring.blocks);

  blocks.push(heading(2, `${scoring.next}. Trace`), heading(3, "Model calls, in order"), ...activityTrace(activities));
  blocks.push(
    heading(3, "Reasoning trace, latest chat turn"),
    para("The typed questions Meridian asked TypeSafe and what it answered. Questions marked No were fetched speculatively and did not affect the reply."),
    ...reasoningTrace(trace),
  );
  return { title, blocks };
}

const EXTENSIONS: Record<ReportFormat, string> = { html: "html", pdf: "pdf", docx: "docx", md: "md" };

export function reportFilename(document: { name: string } | null, at: number, format: ReportFormat = "html"): string {
  const slug = (document?.name ?? "session").replace(/\.[a-z0-9]+$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "session";
  const d = new Date(at).toISOString();
  return `meridian-report-${slug}-${d.slice(0, 10).replace(/-/g, "")}-${d.slice(11, 16).replace(":", "")}.${EXTENSIONS[format]}`;
}
