import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "../activity/log";
import type { StoredEvaluationRow } from "../eval/store";
import type { EvalKind, EvalResult } from "../eval/types";
import type { TraceEntry } from "../orchestrator/run";
import { buildReportDoc, buildReportTable, cell, reportFilename, type ReportInput } from "./buildReport";
import { renderMarkdown } from "./render/markdown";
import { fmtUsd } from "../compare/pricing";

const buildReportMarkdown = (input: ReportInput) => renderMarkdown(buildReportDoc(input));

const result = (score: number, over: Partial<EvalResult> = {}): EvalResult => ({
  score, reason: "The ratings match the liability clause in section 9.", success: score >= 0.6, threshold: 0.6, judgeModel: "gpt-judge",
  rubric: { id: "risk", version: "2", title: "Risk rubric" }, steps: ["Find the clause", "Compare the rating"],
  bands: [{ low: 0, high: 5, outcome: "Wrong" }, { low: 6, high: 10, outcome: "Supported" }],
  integrity: { status: "clean", signals: [], hiddenCharsRemoved: 0 }, latencyMs: 1500, judgeCostUsd: 0.000123, ...over,
});
const row = (scope: string, backend: "typesafe" | "openai", kind: EvalKind, r: EvalResult | null, over: Partial<StoredEvaluationRow> = {}): StoredEvaluationRow => ({
  scope, backend, kind, sig: "s", pending: false, auto: false,
  outcome: r ? { ok: true, result: r } : null,
  packet: { input: "Rate the risk", actualOutput: "Overall risk: 70%", contextChars: 12345 },
  ...over,
});

describe("cell", () => {
  it("clips long text with an ellipsis and collapses whitespace", () => {
    expect(cell("a".repeat(100), 10)).toBe("aaaaaaaaa…");
    expect(cell("one\n\n two | three")).toBe("one two | three");
  });
  it("writes missing values as n/a", () => {
    expect([cell(null), cell(undefined), cell(""), cell("  ")]).toEqual(["n/a", "n/a", "n/a", "n/a"]);
  });
});

describe("buildReportTable", () => {
  const evals = [
    row("risk", "typesafe", "risk", result(0.85), { response: { ms: 2400, reasoningMs: 900, writingMs: 1500, costUsd: 0.00142, reasoningCostUsd: 0.00042, writingCostUsd: 0.001 } }),
    row("risk", "openai", "risk", result(0.4), { response: { ms: 850, reasoningMs: 850, writingMs: null, costUsd: 0, reasoningCostUsd: 0, writingCostUsd: null } }),
    row("citation", "typesafe", "citation", result(0.9)),
    row("compliance:excerpt", "typesafe", "compliance", result(0.7)),
  ];
  const table = buildReportTable(evals);
  const col = (name: string) => table.columns.indexOf(name);

  it("has one row per activity and model, in kind order, with a row even for a model that was not evaluated", () => {
    expect(table.rows.map((r) => `${r[col("Activity")]} / ${r[col("Scope")]} / ${r[col("Model")]}`)).toEqual([
      "Risk score / Whole document / TypeSafe",
      "Risk score / Whole document / OpenAI",
      "Compliance flags / Excerpt / TypeSafe",
      "Compliance flags / Excerpt / OpenAI",
      "Citation verdict / Cited section / TypeSafe",
      "Citation verdict / Cited section / OpenAI",
    ]);
    expect(table.rows.every((r) => r.length === table.columns.length)).toBe(true);
  });

  it("takes scores and outcomes straight from the evaluation", () => {
    const [ts, oa] = table.rows;
    expect(ts[col("Score")]).toBe("85%");
    expect(ts[col("Result")]).toBe("Pass");
    expect(ts[col("Band (0-10)")]).toBe("6-10");
    expect(ts[col("Rubric")]).toBe("risk v2");
    expect(ts[col("Model total time")]).toBe("2.4s");
    expect(ts[col("Total cost")]).toBe(fmtUsd(0.00142));
    expect(oa[col("Score")]).toBe("40%");
    expect(oa[col("Result")]).toBe("Fail");
  });

  it("shows the answering model's three times and three costs, not the judge's, and has no Integrity or judge columns", () => {
    for (const gone of ["Integrity", "Resp. time", "Resp. cost", "Judge time", "Judge cost", "Judge model"]) expect(table.columns).not.toContain(gone);
    const c = table.columns;
    expect(c.slice(c.indexOf("Model total time"), c.indexOf("Model total time") + 6)).toEqual([
      "Model total time", "Model reasoning", "LLM response", "Total cost", "Cost for reasoning", "Cost for LLM response",
    ]);
    const [ts, oa] = table.rows;
    expect([ts[col("Model total time")], ts[col("Model reasoning")], ts[col("LLM response")]]).toEqual(["2.4s", "900ms", "1.5s"]);
    expect([ts[col("Total cost")], ts[col("Cost for reasoning")], ts[col("Cost for LLM response")]]).toEqual([fmtUsd(0.00142), fmtUsd(0.00042), fmtUsd(0.001)]);
    // The total is the two parts added together.
    expect(0.00042 + 0.001).toBeCloseTo(0.00142, 9);
    expect(oa[col("Model total time")]).toBe("850ms");
    expect(oa[col("LLM response")]).toBe("n/a"); // no model wrote it
    expect(oa[col("Cost for LLM response")]).toBe("n/a");
    expect(oa[col("Total cost")]).toBe(fmtUsd(0)); // a call that really cost nothing is a cost, not n/a
  });

  it("writes n/a, never zero, when no call was measured behind an answer", () => {
    const [, , citationTs] = table.rows; // the citation row was stored without a response
    for (const name of ["Model total time", "Model reasoning", "LLM response", "Total cost", "Cost for reasoning", "Cost for LLM response"]) expect(citationTs[col(name)]).toBe("n/a");
    const noMs = buildReportTable([row("risk", "typesafe", "risk", result(0.8), { response: { ms: null, reasoningMs: null, writingMs: null, costUsd: 0.001, reasoningCostUsd: 0.001, writingCostUsd: null } })]);
    expect(noMs.rows[0][col("Model total time")]).toBe("n/a");
    expect(noMs.rows[0][col("Total cost")]).toBe(fmtUsd(0.001));
  });

  it("shows why a model has no score instead of a zero", () => {
    const missing = table.rows[3]; // compliance excerpt, OpenAI
    expect(missing[col("Status")]).toBe("Not evaluated");
    expect(missing[col("Score")]).toBe("n/a");
    const failed = buildReportTable([row("risk", "typesafe", "risk", null, { outcome: { ok: false, reason: "error", code: "judge_rate_limited" } })]);
    expect(failed.rows[0][col("Status")]).toBe("Failed (judge_rate_limited)");
    const pending = buildReportTable([row("risk", "typesafe", "risk", null, { pending: true })]);
    expect(pending.rows[0][col("Status")]).toBe("Pending");
  });

  it("clips the judge's explanation so the table stays readable", () => {
    const long = buildReportTable([row("risk", "typesafe", "risk", result(0.8, { reason: "x".repeat(500) }))]);
    expect(long.rows[0][col("Judge's explanation")].length).toBeLessThanOrEqual(90);
  });

  it("is empty with no evaluations", () => {
    expect(buildReportTable([]).rows).toEqual([]);
  });
});

describe("buildReportMarkdown", () => {
  const at = Date.UTC(2026, 8, 20, 14, 30, 5);
  const activity = (over: Partial<ActivityRecord>): ActivityRecord => ({
    id: 1, actor: "typesafe", kind: "chat", label: "Analyze this contract", status: "done", startedAt: at, endedAt: at + 900, modelMs: 900, ...over,
  });
  const trace: TraceEntry[] = [
    { skill: "clauseRisk", questionId: "liability", question: { type: "score", instructions: "", criteria: [] }, answer: { type: "score", score: 2, legend: { "0": "a", "1": "b", "2": "c" }, probabilities: {}, confidence: 0.8 }, used: true },
  ];
  const md = buildReportMarkdown({
    generatedAt: at,
    document: { name: "msa.pdf", contractType: "MSA" },
    evals: [row("risk", "typesafe", "risk", result(0.85)), row("risk", "openai", "risk", result(0.4)), row("citation", "typesafe", "citation", result(0.9, { rubric: { id: "citation", version: "1", title: "Citation rubric" } }))],
    activities: [activity({ model: "jev" }), activity({ id: 2, actor: "judge", kind: "evaluation", label: "Risk score evaluation: TypeSafe", model: "gpt-judge", score: 0.85, costUsd: 0.0001 })],
    trace,
  });

  it("puts the data table first, before any explanation", () => {
    const table = md.indexOf("## 1. Evaluation data");
    expect(table).toBeGreaterThan(-1);
    expect(md.indexOf("| Activity |")).toBeGreaterThan(table);
    expect(md.indexOf("| Activity |")).toBeLessThan(md.indexOf("## 2."));
  });

  it("has scoring with the judge's explanation for risk, compliance and citations", () => {
    expect(md).toContain("## 2. Risk: scoring and explanation");
    expect(md).toContain("## 3. Compliance: scoring and explanation");
    expect(md).toContain("## 4. Citations: scoring and explanation");
    expect(md).toContain("> The ratings match the liability clause in section 9.");
    expect(md).toContain("**Score: 85% (9/10), Pass.**");
    expect(md).toContain("Band 6-10: Supported");
    expect(md).toContain("1. Find the clause");
    expect(md).toContain("Overall risk: 70%");
    expect(md).toContain("**Head to head.** TypeSafe scored 45 points higher");
  });

  it("quotes a short source, and only counts a long one", () => {
    const short = row("risk:excerpt", "typesafe", "risk", result(0.8), { packet: { input: "q", actualOutput: "a", contextChars: 20, context: "The Supplier's liability is unlimited." } });
    const full = row("risk", "typesafe", "risk", result(0.8));
    const out = buildReportMarkdown({ generatedAt: at, document: null, evals: [short, full], activities: [], trace: [] });
    expect(out).toContain("**Source text it was checked against.**");
    expect(out).toContain("The Supplier's liability is unlimited.");
    expect(out).toContain("Judged against 12,345 characters of source text (the full document, not repeated here).");
  });

  it("says plainly when a kind was never evaluated", () => {
    expect(md).toContain("No compliance evaluation has run in this session.");
  });

  it("ends with the trace: every model call in order, and the reasoning trace", () => {
    expect(md).toContain("### Model calls, in order");
    expect(md).toMatch(/\| 1 \| 14:30:05 \| TypeSafe \| Analyze this contract \| Done \| 900ms \| jev/);
    expect(md).toMatch(/\| 2 \| 14:30:05 \| Judge \| Risk score evaluation: TypeSafe/);
    expect(md).toContain("### Reasoning trace, latest chat turn");
    expect(md).toContain("2 of 2 (confidence 80%)");
    expect(md).toContain("**Models:** TypeSafe: jev · OpenAI: n/a · Judge: gpt-judge");
    expect(md).toContain("**Document:** msa.pdf (MSA)");
  });

  it("names the local demo heuristic rather than hiding it", () => {
    const out = buildReportMarkdown({ generatedAt: at, document: null, evals: [], activities: [activity({ model: "demo heuristic", simulated: true })], trace: [] });
    expect(out).toContain("TypeSafe: demo heuristic (simulated, not evaluated)");
  });

  it("still produces a valid report before anything has run", () => {
    const empty = buildReportMarkdown({ generatedAt: at, document: null, evals: [], activities: [], trace: [] });
    expect(empty).toContain("No evaluations have run yet");
    expect(empty).toContain("No model calls have been made");
    expect(empty).toContain("**Document:** none loaded");
  });

  it("never lets model output break out of its code fence", () => {
    const evil = row("risk", "typesafe", "risk", result(0.8), { packet: { input: "q", actualOutput: "```\n# injected heading", contextChars: 1 } });
    const out = buildReportMarkdown({ generatedAt: at, document: null, evals: [evil], activities: [], trace: [] });
    expect(out).toContain("````text\n```\n# injected heading\n````");
  });
});

describe("reportFilename", () => {
  it("is a safe name with the document and a UTC timestamp", () => {
    expect(reportFilename({ name: "Acme MSA (final).PDF" }, Date.UTC(2026, 8, 20, 14, 30))).toBe("meridian-report-acme-msa-final-20260920-1430.html");
    expect(reportFilename(null, Date.UTC(2026, 8, 20, 14, 30))).toBe("meridian-report-session-20260920-1430.html");
  });
  it("carries the extension of the chosen format", () => {
    const at = Date.UTC(2026, 8, 20, 14, 30);
    expect((["html", "pdf", "docx", "md"] as const).map((f) => reportFilename(null, at, f).split(".").pop())).toEqual(["html", "pdf", "docx", "md"]);
  });
});
