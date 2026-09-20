import type { TraceEntry } from "@/lib/orchestrator/run";
import type { OpenAIRunOutcome } from "@/lib/openai/types";
import { agrees, openaiAnswerFor } from "@/lib/compare/agreement";
import type { CompareGroup, CompareRow } from "@/lib/compare/rows";
import { openaiCell, typesafeCell } from "@/lib/trace/cells";
import { questionLabel } from "@/lib/trace/labels";
import { ComparisonTable } from "./ComparisonTable";

const SKILL_LABELS: Record<string, string> = {
  guardrails: "Guardrails",
  intake_router: "Intake router",
  contract_type: "Contract type",
  clause_risk: "Clause risk",
  compliance_guard: "Compliance guard",
};

/** The questions of one Jev call as comparison groups: consecutive questions from one skill share a header row. */
export function traceGroups(entries: TraceEntry[], openaiOutcome: OpenAIRunOutcome | null, openaiConfigured: boolean): CompareGroup[] {
  const groups: CompareGroup[] = [];
  for (const entry of entries) {
    const ts = typesafeCell(entry.answer);
    const oa = openaiAnswerFor(openaiOutcome, entry.questionId);
    const row: CompareRow = {
      id: entry.questionId,
      title: questionLabel(entry.questionId),
      subtitle: entry.questionId,
      mono: true,
      ts: { main: ts.main, sub: ts.sub, bar: ts.bar, detail: ts.detail },
      oa: oa ? openaiCell(entry.answer, oa.value, oa.selfReportedConfidence) : openaiConfigured ? "no answer" : "not run",
      match: oa ? agrees(entry.answer, oa.value) : null,
    };
    const last = groups[groups.length - 1];
    if (last && last.id === entry.skill) last.rows.push(row);
    else groups.push({ id: entry.skill, label: SKILL_LABELS[entry.skill] ?? entry.skill, rows: [row] });
  }
  for (const g of groups) g.note = `${g.rows.length} question${g.rows.length === 1 ? "" : "s"}`;
  return groups;
}

/**
 * The questions of one Jev call, one row each: what was asked, TypeSafe's answer, OpenAI's answer to the identical
 * question, and whether they agree. `dimmed` marks the speculative questions the reply did not use.
 */
export function TraceTable({
  entries,
  openaiOutcome,
  openaiConfigured,
  dimmed = false,
  label,
}: {
  entries: TraceEntry[];
  openaiOutcome: OpenAIRunOutcome | null;
  openaiConfigured: boolean;
  dimmed?: boolean;
  label: string;
}) {
  return <ComparisonTable groups={traceGroups(entries, openaiOutcome, openaiConfigured)} label={label} firstColumn="Question" dimmed={dimmed} />;
}
